/**
 * Runs once in the main process. Builds etm_test_template from src/db/schema.ts (only when the schema hash
 * changed), then gives every Vitest worker a fresh clone etm_test_<VITEST_POOL_ID>. Cloning a template is a file
 * copy, so each run starts from empty tables without any truncating. tests/setup-db.ts points workers at their clone.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import { TEMPLATE_DB, dbUrl, workerDbName } from "./helpers/env";

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

async function buildTemplate(hash: string) {
  await withClient(dbUrl("postgres"), async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  });
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const schema = await import("../src/db/schema");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
  await withClient(dbUrl(TEMPLATE_DB), async (c) => {
    for (const s of statements) await c.query(s);
    await c.query("CREATE TABLE _etm_schema_hash (hash text not null)");
    await c.query("INSERT INTO _etm_schema_hash VALUES ($1)", [hash]);
  });
}

export default async function setup(project: TestProject) {
  const hash = createHash("sha256").update(readFileSync("src/db/schema.ts")).digest("hex");
  if ((await templateHash()) !== hash) await buildTemplate(hash);

  const workers = Number(project.config.maxWorkers) || availableParallelism();
  await withClient(dbUrl("postgres"), async (c) => {
    await Promise.all(
      Array.from({ length: workers }, async (_, i) => {
        const name = workerDbName(i + 1);
        await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await c.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`);
      }),
    );
  });
}
