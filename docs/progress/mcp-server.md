# mcp-server: stateless streamable HTTP MCP at /api/mcp, Bearer etm_ token, 8 tools over src/services

Status: done
Branch: task/mcp-server   Last commit: see `git log task/mcp-server`

## Done
- `POST /api/mcp`: `Authorization: Bearer etm_…` → `tokens.verify` → `people.getById` → `actorFromToken` (kind/via `mcp`).
  No token, a bad token, or a revoked token gets a 401 with `WWW-Authenticate: Bearer`. GET and DELETE get a 405.
- It is stateless and uses the same approach as eci-events-mcp. Current clients go through `createMcpHandler` (JSON
  responses). Clients on the 2025-11-25 protocol, which open with `initialize`, get a per-request
  `WebStandardStreamableHTTPServerTransport` with `enableJsonResponse`.
- Tools:
  - `whoami`
  - `list_requests`: box inbox (the default), raised, or all (admins only). Status can be open, done, all, or one
    exact status. It also takes an @username filter, a limit and an offset.
  - `get_request`: the body, every message with its kind (original, append, thread), its t.me link and
    replyToMessageId, attachments as absolute signed `/api/files/<id>?sig=` URLs, the audit timeline, aiQuestion,
    and requester, assignee and creator.
  - `create_request`: the requester is the token's person. An unknown @assignee gets a username-only placeholder
    row.
  - `update_status`
  - `add_comment`: notify defaults to true.
  - `set_due`: takes YYYY-MM-DD (meaning the end of that IST day), an ISO timestamp, or null.
  - `set_priority`
- Each tool returns its result twice: as JSON text and as `structuredContent`. Service errors come back as
  `CODE: message` (for example `PERMISSION_DENIED`, `NOT_FOUND`, `VALIDATION_FAILED`). Any other error is logged and
  returned as `INTERNAL_ERROR`.
- Effects go through `after(() => runEffects(effects))`. `createMcpServer(actor, deps?)` accepts an optional
  `{ db, schedule }` so tests can capture effects.
- The server instructions explain requests, boxes, statuses and custom labels, and that the signed URLs are public.
  They also say that changes notify people on Telegram, so the client should confirm with the user first.

## Tests
- `tests/db/mcp.test.ts` (DB project, 10 tests):
  - tools/list and instructions
  - each tool, including the inbox/raised/status/person filters and the admin-only `all` box
  - permission denied and not found
  - the placeholder assignee
  - one audit row per mutation, written with via `mcp`
  - comment notify defaults to true
  - date-only due dates
  - Route checks: 401 with no token and with a bad token; with a real token, initialize then whoami on the
    2025-11-25 protocol; GET returns 405.
- `pnpm test`: 53/53 passed in 9.6s (vitest; 12.4s wall). `tsc --noEmit` is clean. eslint on the new files is
  clean.
- e2e against `pnpm dev --port 3206` with `DATABASE_URL=…/etm_mcp_server` (scripts/dev-db.mjs + seed-dev.mjs, with a
  token minted through `tokens.create` for @asha):
  - Calls run: 401, initialize, tools/list (all 8 tools), whoami, list_requests, get_request (#15, and #11 which
    has a photo), add_comment.
  - A modern request with no protocol-version header returned tools/list as JSON.
  - The signed file URL was accepted (it returned 503 only because the dev database has no real Telegram file). A
    bad signature returned 404.

## Open issues
- The tests were written before the code, but I couldn't watch them fail first: `pnpm install` was still running.
- There are no UI screenshots. This task has no UI, and at c41c34b `/r/[id]` and `/settings` are still
  "Coming soon" stubs, so I deleted the stub shots instead of committing them. The MCP config snippet on
  `/settings` belongs to the settings task.
- Cross-worktree test collision: every worktree's vitest workers use the same `etm_test_<POOL_ID>` names on the
  shared :5545 Postgres. One run failed with `database "etm_test_1" already exists` while another worktree was
  testing, and passed on retry. Fix (not mine): add a per-checkout prefix in `tests/helpers/env.ts` `workerDbName`.
- The DB test lives at `tests/db/mcp.test.ts`, not next to the code, because only `tests/db/**` and
  `src/services/__tests__` run in the DB project.
- `create_request` writes two audit rows when the assignee is new (`person.create` for the placeholder, then
  `request.create`). That is two service mutations, each with its own row.
- No new dependencies: the tests drive the server with raw JSON-RPC rather than adding `@modelcontextprotocol/client`.
  There is no OAuth, only the Bearer token the SPEC asks for.

## Files owned
- src/app/api/mcp/route.ts
- src/lib/mcp/server.ts
- tests/db/mcp.test.ts
- docs/progress/mcp-server.md
