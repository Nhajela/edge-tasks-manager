// Dev only: print a magic login URL for a (fake) person in a local dev database. eci-travel-coop pattern.
// Usage: DATABASE_URL=postgres://postgres@localhost:5545/<db> node scripts/dev-login.mjs <username|telegramId> [baseUrl]
import { randomBytes } from "node:crypto";
import pg from "pg";

const [who, base = "http://localhost:3000"] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!who || !url) throw new Error("usage: DATABASE_URL=... node scripts/dev-login.mjs <username|telegramId> [baseUrl]");
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("Refusing: dev-login only works on a local database");

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  const { rows } = await c.query(
    /^\d+$/.test(who)
      ? "SELECT telegram_id, username, first_name FROM people WHERE telegram_id = $1"
      : "SELECT telegram_id, username, first_name FROM people WHERE username = lower($1)",
    [who.replace(/^@/, "")],
  );
  const p = rows[0];
  if (!p?.telegram_id) throw new Error(`No person with a telegram id matches ${who} (run scripts/seed-dev.mjs?)`);
  const code = randomBytes(18).toString("base64url");
  await c.query(
    "INSERT INTO login_codes (code, telegram_id, username, first_name, claimed_at, expires_at) VALUES ($1, $2, $3, $4, now(), now() + interval '1 day')",
    [code, p.telegram_id, p.username, p.first_name ?? "Tester"],
  );
  console.log(`${base.replace(/\/+$/, "")}/login?code=${code}`);
} finally {
  await c.end();
}
