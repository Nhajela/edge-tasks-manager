// One-off data migration (round 2): in-thread status commands (/done, /doing …) were stored as request_messages kind
// 'thread'. Re-tag them 'status': the matching request.status audit row recorded their Telegram message id.
// Run after the schema push that allows kind 'status'. Idempotent.
// Usage: node --env-file=.env.local scripts/migrate-status-kind.mjs   (or DATABASE_URL=... node scripts/...)
import { register as registerCjs } from "tsx/cjs/api";
import { register } from "tsx/esm/api";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
register();
registerCjs();
const { createDb } = await import("../src/db/index.ts");
const { sql } = await import("drizzle-orm");

const res = await createDb(url).execute(sql`
  UPDATE request_messages rm SET kind = 'status'
  FROM audit_log a
  WHERE rm.kind = 'thread'
    AND a.action = 'request.status' AND a.entity_type = 'request' AND a.entity_id = rm.request_id::text
    AND a.data ? 'messageId' AND jsonb_typeof(a.data->'messageId') = 'number'
    AND (a.data->>'messageId')::bigint = rm.message_id
  RETURNING rm.id`);
console.log(`re-tagged ${(res.rows ?? res).length} status message(s)`);
process.exit(0);
