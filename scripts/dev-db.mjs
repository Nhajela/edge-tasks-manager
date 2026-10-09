// Dev only: (re)create database <name> on the local Docker Postgres (localhost:5545) with the current schema.
// Clones the test template when it exists (instant), else creates it empty and runs drizzle-kit push.
// Usage: node scripts/dev-db.mjs <name>      then: DATABASE_URL=postgres://postgres@localhost:5545/<name> pnpm dev --port <p>
import { execFileSync } from "node:child_process";
import pg from "pg";

const name = process.argv[2];
if (!name || !/^[a-z_][a-z0-9_]{0,40}$/.test(name) || name.startsWith("etm_test_"))
  throw new Error("usage: node scripts/dev-db.mjs <name>   (lowercase letters, digits, _; not etm_test_*)");
const server = process.env.DEV_PG_URL || "postgres://postgres@localhost:5545";
if (/neon\.tech/.test(server)) throw new Error("dev-db only talks to the local Docker Postgres");
const url = (db) => Object.assign(new URL(server), { pathname: `/${db}` }).toString();

async function q(db, sql) {
  const c = new pg.Client({ connectionString: url(db) });
  await c.connect();
  try {
    return await c.query(sql);
  } finally {
    await c.end();
  }
}

const hasTemplate = (await q("postgres", "SELECT 1 FROM pg_database WHERE datname = 'etm_test_template'")).rowCount > 0;
await q("postgres", `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
if (hasTemplate) {
  // ponytail: the template is only as fresh as the last `pnpm test:db`; run that first after schema edits
  await q("postgres", `CREATE DATABASE ${name} TEMPLATE etm_test_template`);
  await q(name, "DROP TABLE IF EXISTS _etm_schema_hash");
} else {
  await q("postgres", `CREATE DATABASE ${name}`);
  execFileSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "push", "--force"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url(name) },
  });
}
console.log(url(name));
