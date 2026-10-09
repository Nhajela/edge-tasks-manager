# infra-ci-files: CI workflow, test DB isolation, hardened /api/files with optional R2 mirror

Status: done
Branch: task/infra-ci-files   Last commit: see `git log -1 task/infra-ci-files`

## Done
- `/api/files/<id>?sig=…[&exp=…]`: HMAC sig, optional expiry (exp is inside the signed payload, so it can't be
  extended). `fileUrl(id)` is unchanged; `fileUrl(id, { ttlSeconds })` makes an expiring link.
- Telegram streaming: content-type is file.mime, then the upstream type, then a kind default. content-length is passed
  through. `content-disposition` uses RFC 5987 `filename*` so non-ASCII names no longer break the header.
  Cache headers: `public, max-age=86400, immutable`, or max-age capped to the seconds left for expiring links.
  Errors send `no-store` (404 bad sig/missing, 503 no bot token, 410 Telegram lost the file, 502 upstream failure).
- R2 adapter (`src/lib/files.ts`, no new dependency, hand-rolled SigV4 checked against the AWS `get-vanilla`
  vector). It is used only when all of R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_PUBLIC_URL are
  set. Key: `attachments.r2_key` if set, else `attachments/<id>-<telegram_file_unique_id>`. Flow: HEAD the public
  URL, then 302 to it if it exists. Otherwise fetch from Telegram, PUT to R2 and serve the bytes. A failed PUT is
  logged and the file is still served.
- Test DB isolation: worker clones are now `etm_test_<runId>_<pool>` (runId = main pid via `project.provide`), so
  parallel runs from other worktrees on :5545 no longer `DROP … WITH (FORCE)` each other's databases. That was a
  real flake (`57P01 terminating connection due to administrator command`, 1 in 5 full runs). Clones are dropped in
  globalSetup teardown. The template is built under a temp name and renamed in, so a concurrent run never clones a
  half-built template.
- pg deprecations fixed: clones are created one statement at a time instead of `Promise.all` on one client. That
  removes "client.query() when the client is already executing", and the `activeQuery`/`queryQueue` warnings went
  away with it.
- `.github/workflows/ci.yml`: a `check` job (typecheck and lint) and a `test` job with 2 shards
  (`pnpm test --shard=N/2`). Postgres runs as a postgres:18 service on tmpfs with trust auth, and fsync,
  synchronous_commit and full_page_writes are turned off with ALTER SYSTEM plus a reload, because service containers
  can't take `-c` args. Uses pnpm (version from packageManager) and Node 22.

## Tests
- `src/lib/files.test.ts` (unit, 14 tests): expiry sign/verify (valid, expired, tampered exp, missing exp, sig
  without exp), the fileUrl shape, the SigV4 reference vector, r2Config all-or-nothing, and serveFile adapter
  selection with a fake fetch (Telegram stream, expiring max-age, 503/410, R2 redirect when mirrored, mirror on
  first fetch, PUT failure still serves).
- The old `pure.test.ts` signing test still passes (backward compatible).
- Timings (local, Windows, :5545 shared with other worktrees):
  - `pnpm test`: 54/54 in 5.2s vitest (7.6s wall). Five consecutive full runs were green after the fix.
  - `pnpm test:unit`: 19 in 0.4s.
  - `pnpm test:db`: 31 in 5.5s (7.7s wall).
  - `pnpm test:changed`: 19 in 0.4s (2.4s wall).
  - Shards: 1/2 has 29 tests (4.3s), 2/2 has 25 tests (3.1s).
- `pnpm typecheck` is clean. `pnpm lint` shows only the old `tokens.ts` `_h` warning.
- CI was not run: I never pushed, so the workflow is unverified on GitHub (YAML parses).

## Open issues
- docs/SPEC.md and docs/DEV.md still describe worker DBs as `etm_test_<VITEST_POOL_ID>`. They should say
  `etm_test_<runId>_<pool>` (not my files). `scripts/dev-db.mjs` still works, because the template name is
  unchanged.
- Old `etm_test_1..16` databases from runs before this change stay on :5545 until each worktree picks this up. A
  run killed before teardown leaves its `etm_test_<pid>_*` databases behind. They are harmless, and you can drop
  them by hand.
- ponytail: the R2 path finds mirrored objects with a HEAD on the public URL (one extra request per hit) instead of
  writing `attachments.r2_key`. Writing it would need a new audited service mutation (`attachments.setR2Key`).
  Upgrade if HEAD latency matters.
- ponytail: when R2 is on, the first fetch buffers the file in memory (Telegram bot downloads cap at 20 MB).
- Once a file is mirrored, the 302 goes to a public, non-expiring R2 URL, so `exp` only limits our link and not the
  object. Use R2 presigned GETs if attachments must really expire.
- `.env.example` does not list `R2_*` or `FILES_SECRET` yet (not my file).

## Files owned
- .github/workflows/ci.yml
- src/lib/files.ts, src/lib/files.test.ts
- src/app/api/files/[id]/route.ts
- tests/global-setup.ts, tests/setup-db.ts, tests/helpers/env.ts
- docs/progress/infra-ci-files.md
