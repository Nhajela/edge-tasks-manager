/** Runs in each DB-project worker before each file: point the app's db() at this worker's clone. */
import { afterAll } from "vitest";
import { dbUrl, workerDbName } from "./helpers/env";

process.env.DATABASE_URL = dbUrl(workerDbName(process.env.VITEST_POOL_ID ?? "1"));
process.env.SESSION_SECRET ||= "test-session-secret";
process.env.SUPERADMIN_USERNAME = "etm_admin_test";
delete process.env.SUPERADMIN_TELEGRAM_ID;

afterAll(async () => {
  const { closeTestDb } = await import("./helpers/db");
  await closeTestDb();
});
