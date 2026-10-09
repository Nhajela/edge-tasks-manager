import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

/** Works for neon-http (prod) and node-postgres (tests). No interactive transactions: neon-http has none. */
export type DbClient = PgDatabase<PgQueryResultHKT, typeof schema>;

/** neon-http for *.neon.tech, node-postgres for anything else (local/CI Postgres). */
export function createDb(url: string): DbClient {
  if (/\.neon\.tech/.test(url)) return drizzleNeon(neon(url), { schema }) as unknown as DbClient;
  return drizzlePg(new Pool({ connectionString: url, max: 5 }), { schema }) as unknown as DbClient;
}

let client: DbClient | null = null;

/** Lazily created so builds don't need DATABASE_URL. */
export function db(): DbClient {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = createDb(url);
  }
  return client;
}
