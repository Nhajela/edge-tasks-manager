import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import type { DbClient } from "@/db";

let pool: Pool | null = null;
let client: DbClient | null = null;

/** This worker's clone (see tests/global-setup.ts). */
export function testDb(): DbClient {
  if (!client) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    client = drizzle(pool, { schema }) as unknown as DbClient;
  }
  return client;
}

export async function closeTestDb() {
  await pool?.end();
  pool = null;
  client = null;
}
