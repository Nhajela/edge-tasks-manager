/**
 * Runs once in the main process. Builds etm_test_template from src/db/schema.ts (only when the schema hash
 * changed), then gives every Vitest worker a fresh clone etm_test_<runId>_<VITEST_POOL_ID>. Cloning a template is
 * a file copy, so each run starts from empty tables without any truncating. tests/setup-db.ts points workers at
 * their clone. runId keeps concurrent runs (several worktrees, one :5545 server) out of each other's databases.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import { TEMPLATE_DB, dbUrl, workerDbName } from "./helpers/env";

declare module "vitest" {
  interface ProvidedContext {
    etmRunId: string;
  }
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function templateHash(): Promise<string | null> {
  try {
    return await withClient(dbUrl(TEMPLATE_DB), async (c) => {
      const r = await c.query("SELECT hash FROM _etm_schema_hash LIMIT 1");
      return (r.rows[0]?.hash as string) ?? null;
    });
  } catch {
    return null;
  }
}

/** Builds under a private name, then swaps it in, so a concurrent run never clones a half-built template. */
async function buildTemplate(hash: string) {
  const tmp = `etm_tpl_build_${process.pid}`;
  await withClient(dbUrl("postgres"), async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${tmp} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${tmp}`);
  });
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const schema = await import("../src/db/schema");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
  await withClient(dbUrl(tmp), async (c) => {
    for (const s of statements) await c.query(s);
    await c.query("CREATE TABLE _etm_schema_hash (hash text not null)");
    await c.query("INSERT INTO _etm_schema_hash VALUES ($1)", [hash]);
  });
  await withClient(dbUrl("postgres"), async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
    try {
      await c.query(`ALTER DATABASE ${tmp} RENAME TO ${TEMPLATE_DB}`);
    } catch {
      await c.query(`DROP DATABASE IF EXISTS ${tmp}`); // another run swapped its build in first; same schema
    }
  });
}

export default async function setup(project: TestProject) {
  const hash = createHash("sha256").update(readFileSync("src/db/schema.ts")).digest("hex");
  if ((await templateHash()) !== hash) await buildTemplate(hash);

  const runId = String(process.pid);
  project.provide("etmRunId", runId);
  const workers = Number(project.config.maxWorkers) || availableParallelism();
  const names = Array.from({ length: workers }, (_, i) => workerDbName(runId, i + 1));
  // one statement at a time: pg@9 drops queued concurrent queries, and Postgres clones serially anyway
  await withClient(dbUrl("postgres"), async (c) => {
    for (const name of names) {
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`);
    }
  });

  return async () => {
    await withClient(dbUrl("postgres"), async (c) => {
      for (const name of names) await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    });
  };
}
