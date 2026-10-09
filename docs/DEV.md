# Local development

Everything runs against the local Docker Postgres on `localhost:5545` (container `etm-test-pg`; `pnpm test-db`
recreates it). Never point dev scripts or tests at Neon. Each task / worktree uses its **own database and port**.

```sh
# 1. a fresh database with the current schema (clones the test template; run `pnpm test:db` first after schema edits)
node scripts/dev-db.mjs etm_dev_inbox

# 2. fake people (telegram ids 91000000xx) + 15 requests across all statuses, messages, a 4-message reply chain,
#    photos and audit rows, all written through src/services. Re-running is a no-op.
DATABASE_URL=postgres://postgres@localhost:5545/etm_dev_inbox node scripts/seed-dev.mjs

# 3. run the app on your own port
DATABASE_URL=postgres://postgres@localhost:5545/etm_dev_inbox pnpm dev --port 3101

# 4. log in as a seeded person: prints a /login?code= link (confirm page, then you're in)
DATABASE_URL=postgres://postgres@localhost:5545/etm_dev_inbox node scripts/dev-login.mjs asha http://localhost:3101
```

Seeded people: `devadmin`, `asha`, `ben`, `chitra`, `dev`, `esha`, Farid (no username), `gopal` (username only, never
talked to the bot). The reply chain is on "Fix the leaking tap in the co-working space".

Admin pages: start the server with `SUPERADMIN_USERNAME=devadmin SUPERADMIN_TELEGRAM_ID=` (shell env beats
`.env.local`) and log in as `devadmin`.

Without a bot token, outgoing Telegram messages are appended to `$TMP/edge-tasks-outbox.jsonl` instead of sent.
Without `OPENROUTER_API_KEY`, the titler keeps the heuristic title.

## Tests

`pnpm test` (unit + DB), `pnpm test:unit`, `pnpm test:db`, `pnpm test:changed`. DB tests clone
`etm_test_template` (rebuilt automatically when `src/db/schema.ts` changes) into one database per worker.

## Schema changes

Edit `src/db/schema.ts`, run `pnpm test:db` (rebuilds the test template), then `pnpm db:push` for the Neon dev
branch. Production (`pnpm db:push:prod`) is the owner's call.
