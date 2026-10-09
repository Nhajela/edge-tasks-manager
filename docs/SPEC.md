# Edge Tasks Manager — spec

A Telegram-first task sheet for Edge City India (community project by @HiiNaman, Oct 11 – Nov 1 2026, Mandrem, Goa).
People raise **requests** (tasks) for other people from any Telegram group the bot is in. Each person gets a
dead-simple web dashboard: requests **to me** (inbox) and requests **I raised** (outbox). AI agents read and update
requests over MCP.

Reference implementation to copy patterns from: `../eci-travel-coop` (Next 16, Neon + drizzle, Telegram login,
bot webhook, UI tokens/components). Copy the Telegram login flow **exactly** (login_codes table, /api/auth/start,
/api/auth/poll, /login?code= confirm page, bot `/start <code>` → "Yes, log me in" callback, magic links, HMAC
session cookie). MCP reference: `../eci-events-mcp/src/mcp`.

**This repo is public: never commit secrets, real Telegram ids, or real user data. `.env*` stays gitignored.**

## Stack
Next.js 16 (read `node_modules/next/dist/docs/` before using APIs — this Next has breaking changes), React 19,
Tailwind 4 + shadcn (base-ui) components copied from eci-travel-coop, drizzle-orm + `@neondatabase/serverless`
(neon-http), vitest, pnpm. Deploy target: Vercel. DB: Neon project `fragrant-morning-27816922`; `.env.local`
DATABASE_URL = `dev` branch, DATABASE_URL_PROD = main. Schema changes: `pnpm db:push` (dev) and
`pnpm db:push:prod`.

Env: DATABASE_URL, SESSION_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, NEXT_PUBLIC_TELEGRAM_BOT_USERNAME,
TELEGRAM_WEBHOOK_SECRET, NEXT_PUBLIC_SITE_URL, SUPERADMIN_USERNAME (HiiNaman), SUPERADMIN_TELEGRAM_ID,
OPENROUTER_API_KEY, OPENROUTER_MODEL (default `google/gemini-2.5-flash`), FILES_SECRET (optional, falls back to
SESSION_SECRET), R2_* (optional, future). The app must run with no bot token (dev outbox like eci-travel-coop:
outgoing messages appended to `$TMP/edge-tasks-outbox.jsonl`, never really sent unless TELEGRAM_SEND_IN_DEV=1) and
with no OpenRouter key (titler falls back to a heuristic title from the first ~8 words).

## Architecture: one service layer, one audit log
Pattern from `../../positivesumlabs/ps-tools/src/services` (read `types.ts`, `errors.ts`, `permissions.ts`, a service
and its `__tests__`). Every business operation lives in `src/services/` as a caller-agnostic function
`fn(db: DbClient, actor: Actor, input)`. **The bot webhook, server actions, API routes, MCP tools and the AI titler
are thin adapters**: they resolve an Actor, call a service, and render the result. Nothing outside `src/services`
writes to the database (except login_codes/session plumbing in `src/lib/login.ts`).
- `DbClient`: drizzle Postgres type that works for both neon-http (prod) and node-postgres (tests); `src/db/index.ts`
  picks neon-http for `*.neon.tech` URLs and `pg` otherwise. Services must not rely on interactive transactions
  (neon-http has none); use single statements, `db.batch`-free sequences that are safe to retry, or `ON CONFLICT`.
- `Actor`: `{ kind: 'person'|'system'|'ai'|'mcp', personId, displayName, isAdmin, via: 'telegram'|'web'|'mcp'|'ai'|'system' }`.
- Typed errors (`NotFoundError`, `PermissionError`, `ValidationError`, `ConflictError`) mapped once per adapter.
- Services: `people`, `requests` (create, append, addThreadMessage, setStatus, comment, setTitle/Priority/Due,
  list*, getDetail), `permissions`, `notifications` (decides who to tell; sending goes through a `Notifier`
  interface so tests capture messages instead of calling Telegram), `tokens`, `aiContext`, `audit`.
- **One audit log**: a single `audit_log` table (id, at, actor_kind, actor_person_id, actor_label, via, action e.g.
  `request.create` / `request.status` / `token.create` / `auth.login`, entity_type, entity_id, summary, data jsonb).
  Every service mutation writes exactly one audit row through `audit.record()` in the same code path. The request
  timeline on `/r/[id]` is a **read view over audit_log** filtered by entity (plus request_messages for message
  content) — there is no separate request_events table. Admin `/admin/activity` shows the global log.
- Side effects that must not slow the webhook (AI titling, notifications) are returned by services as an
  `effects` list or scheduled by adapters with `after()`; services stay deterministic and testable.

## Testing: TDD, fast and parallel
Write the failing test first for every service and parser behaviour, then the code.
- **Unit project** (`*.test.ts` outside `tests/db/`, no DB): parsers, formatters, prompt builders, signing. Fully parallel.
- **DB project** (`tests/db/**/*.test.ts` or `src/services/__tests__`): runs against ONE persistent local Postgres in
  Docker — container `etm-test-pg` on `localhost:5545` (user postgres, trust auth, tmpfs + fsync off; already running;
  `scripts/test-db.sh` recreates it with `postgres:18` if missing). `globalSetup` pushes the schema once into a
  template database `etm_test_template` (only when the schema hash changed — store it in a table), then each Vitest
  worker creates `etm_test_<VITEST_POOL_ID>` from the template (`CREATE DATABASE … TEMPLATE …`, drop-if-exists first)
  and **fileParallelism stays ON**. Tests isolate by creating their own data (unique fake telegram ids 91000000xx +
  counter per worker) rather than truncating; a worker truncates only once at start.
- Never point tests at Neon. `TEST_DATABASE_URL` defaults to `postgres://postgres@localhost:5545`.
- Scripts: `pnpm test` (both projects), `pnpm test:unit`, `pnpm test:db`, `pnpm test:changed` (`vitest --changed`).
  Keep the full suite under ~20s.
- `.github/workflows/ci.yml`: postgres service container with the same fast flags, pnpm, typecheck + lint + test
  sharded across 2 runners.
- e2e (Playwright vs dev server pointing at the local test Postgres, never Neon) is a separate `pnpm e2e`.

## Data model (drizzle, `src/db/schema.ts`)
- `people`: telegram_id (bigint, nullable until known), username (lowercase, no @, nullable), first_name,
  started_bot (bool: can we DM them), created/updated. Unique on telegram_id and on username. Upsert on every
  message we see (from, reply_to.from, entities with `text_mention` users). A request addressed to `@bob` before bob
  has ever talked to the bot creates a people row with username only; bind telegram_id later when seen.
- `requests`: id serial (shown as `#12`), title, body (full text, appended messages joined), status (text),
  custom_status (nullable text — free label shown instead of the status name when set), priority
  (`low|normal|high|urgent`, default normal), due_at (timestamptz nullable), requester_id → people, assignee_id →
  people, created_by_id → people (who ran the command; may differ from requester when someone replies /request to
  another person's message), chat_id, chat_title, source_message_id, message_link, ai_question (nullable),
  ai_status (`pending|done|failed|skipped`), done_at, created/updated.
- `request_messages`: each Telegram message attached to a request (the original + appended ones): request_id,
  chat_id, message_id, from_id → people, text, link, kind (`original|append|thread`), created.
- `audit_log`: the ONE log of every mutation (see Architecture). Comments are audit rows with action
  `request.comment` and the text in `summary`/`data`; the request timeline is read from here.
- `attachments`: request_id, message_id, telegram_file_id, telegram_file_unique_id, kind (`photo|document`),
  mime, file_name, width/height, size, r2_key (nullable, future). Served publicly via
  `/api/files/<id>?sig=<hmac>` which streams from Telegram getFile (or R2 when r2_key set). Signed URLs = no
  enumeration, and AI clients can fetch them without auth.
- `login_codes`, `bot_messages` (copied from eci-travel-coop).
- `api_tokens`: person_id, name, token_hash (sha256), prefix (first 8 chars for display), last_used_at, created,
  revoked_at. Raw token shown once: `etm_<random>`.
- `ai_context`: the titler's memory. id, kind (`fact|question`), text, answer (nullable), request_id (nullable,
  the request that prompted the question), status (`open|answered|dismissed`), created_by, created. Facts + answered
  questions are injected into the titler prompt.

Statuses: `open` (default), `in_progress`, `waiting` (blocked on someone), `done`, `declined`. Plus optional
custom_status label (e.g. "ordering from Panjim") — setting a custom label keeps the underlying status.

## Telegram bot (`/api/telegram`, webhook secret header, always 200)
Works in groups and DMs. Group privacy: commands and replies-to-bot/mentions reach the bot with privacy mode on;
document that for capturing arbitrary messages the bot needs to be admin or privacy off — but **all flows below
work with privacy mode on** because they are commands or mentions.

Parsing rules (pure function in `src/lib/bot/parse.ts`, unit tested heavily):
- `/request @bob fix the projector` → requester = sender, assignee = @bob, body = "fix the projector".
- `/request fix the projector` with no @ and no reply → assignee defaults to the **superadmin**
  (SUPERADMIN_USERNAME), i.e. "a request to the organiser". Same in a DM with the bot.
- **Reply** to someone's message with `/request` → requester = author of the replied-to message, assignee = the
  person replying (the "give this to me" case). `/request @bob` as a reply → assignee = @bob, requester = original
  author. Extra text after the command is added as a note. Replied message text/caption becomes the body; its photo
  is attached.
- Mention = new request, same as `/request`: `@<bot> @bob fix the projector` → request to @bob, body "fix the
  projector". `@<bot> fix the projector` → request to the superadmin. As a reply: `@<bot>` alone → request from the
  replied-to author to the person replying; `@<bot> @bob` → to bob. Only when unambiguous: the bot mention must be the
  first thing in the message (leading whitespace ok); a bot mention later in a sentence ("thanks @<bot>") is ignored. A
  bare `@<bot>` with no text and no reply → short help reply, nothing created. `@<bot> @bob` with no text and no reply →
  ask "What should @bob do? Reply to this with the details" and treat the reply as the body (pending-request row keyed
  by the bot's prompt message id, expires in 1h).
- `/request@<bot> …` command suffix form is handled.
- Multiple @mentions: first @mention right after the command is the assignee; others stay in the text.
- `text_mention` entities (users without usernames) can be the assignee.
- **Append**: reply to a message with `/append` (aliases `/add`, `/more`) → attaches that message to the most
  recent open request **raised by that message's author** in this chat in the last 24h (fallback: most recent open
  request they raised anywhere). `/append 12` → attach to #12 explicitly. If replying to the bot's own
  confirmation, `/append <text>` appends the text to that request. Bot confirms "Added to #12".
- Also: if someone **replies to the bot's "Request #12 created" message** with plain text (no command), treat it as
  an append to #12 (privacy mode delivers replies to the bot's messages).
- Photos: message with photo + caption `/request @bob …` → attach photo. Replied-to photo → attach.
- `/mine` — open requests assigned to me. `/raised` — open requests I raised. `/with @bob` — open requests between
  me and bob both ways ("checking in"). `/status 12` — one request's status. `/done 12` (assignee or requester
  or admin), `/help`, `/start` (login, copied). Lists: max 10, each `#id title — status · due`, with a button to
  open the dashboard.
- On create, bot replies in the chat (reply_to the command message): "📝 #12 for @bob: <title> — open the
  dashboard" with a login-free link to the request page (requires login), and DMs the assignee if they started
  the bot. Title in that reply can be the heuristic one; when the AI title arrives, edit the bot message
  (editMessageText) to the AI title.
- Message links: supergroup `-100XXXX` → `https://t.me/c/XXXX/<msgid>`; public group with username →
  `https://t.me/<username>/<msgid>`; DMs/basic groups → null.
- Loop safety: ignore messages from bots; dedupe by (chat_id, message_id) so Telegram retries don't double-create.

### Reply threads (automatic, any group, no command needed)
Any message from **anyone** that replies to a message tied to a request automatically becomes part of that
request's **thread** in the web UI — no `/append` or `/add` needed. "Tied to a request" = the command message, the
original replied-to message (source), any appended message, the bot's confirmation message, or a message already in
the thread — so replies to replies, at any depth, land in the same thread. Store `reply_to_message_id` on each
thread message so the UI can show a small "↳ replying to <name>: <snippet>" quote above nested replies (flat
chronological list, not indented trees, so it stays readable on a phone).
Rule (transitive): a message belongs to request R if it IS one of R's messages (source, command, appended, bot
confirmation/DM prompts, thread) or it replies to a message that belongs to R. Since every captured message is stored,
any chain of replies that leads back to the request works, however long. Lookup is one indexed query on
(chat_id, message_id) per hop because each hop is stored as it arrives.
Example that must work (and be a test): bot confirms #12 → Asha replies to it → Ben replies to Asha → Asha replies to
Ben → Chitra replies to Ben's message → all four are in #12's thread, in order, each showing who they answered. Store these in `request_messages` with kind `thread` (text/caption,
author, link, photos as attachments) and an audit row `request.thread`. They do NOT change the request body
(that stays `/append`'s job) and do not trigger re-titling. The assignee and requester get a quiet notification only
via the dashboard (no Telegram ping for every thread reply, to avoid spam); the request page shows the thread as a
chat-style conversation with "Open in Telegram" per message. Track every bot message id we send in a group
(`bot_messages` with request_id) so replies to them resolve to the request.
This must work in **any** group the bot is added to. Telegram only delivers non-command replies to human messages
when the bot's privacy mode is OFF (BotFather → /setprivacy → Disable) or the bot is a group admin; replies to the
bot's own messages always arrive. So: README/setup tells the owner to disable privacy mode (do this by default), the
bot's my_chat_member handler warns the superadmin if it was added to a group where it can't read messages
(getMe `can_read_all_group_messages` false and not admin), and all other messages that are not tied to a request are
ignored (never stored).

## Notifications (`src/lib/notify.ts`)
On status change / comment / done by the assignee: DM the requester if `started_bot`; otherwise reply in the
original group thread (reply_to source_message_id) with "✅ @alice, #12 is done: <title>" (for done/declined and
comments marked "notify"). On assignment: DM assignee if possible. Never notify the actor about their own action.
Requester changes (comment from requester) notify the assignee.

## Web UI
Usability > aesthetics (hard rule from the owner). Reuse eci-travel-coop tokens (paper/ink/teal/blue/marigold),
type, Button/Card/Badge/etc. Light touch of glass (floating header pill, sticky action bar) — no grain behind text,
solid high-contrast surfaces for lists and forms. Mobile first (most people open from Telegram's in-app browser).

Pages:
- `/` logged out: one-screen explainer ("Ask anyone at Edge City for something, right from Telegram") with the 3
  commands shown as chat bubbles, and Log in with Telegram. Logged in: redirect to `/inbox`.
- `/inbox` (To me) and `/raised` (I asked): tabs at top with counts. Filter chips: Open (default) · Done · All.
  Each row: priority dot, title, from/to person, status pill (custom label if set), due ("due Fri" / overdue in
  red), age, image thumbnail count. Tap → detail. Quick "Mark done" checkbox on inbox rows (optimistic, undo toast).
- `/r/[id]` detail (visible to requester, assignee, creator, admins): title (editable by assignee/admin), status
  segmented control (Open · Doing · Waiting · Done · Declined) + "Custom label" input with suggestions, priority
  and due editors, original Telegram message(s) with "Open in Telegram" links and photos, timeline of events,
  comment box with "Tell <requester> on Telegram" toggle (default on), AI question card if present (admin can
  answer → goes to ai_context and re-titles).
- `/with/[username]` — everything between me and that person.
- `/context` (admin) — the titler's memory: open questions to answer, facts to add/edit/delete, "Re-title last 20".
- `/settings` — API tokens for MCP (create, copy once, revoke) + copy-paste MCP config snippets for Claude Code
  / claude.ai, and bot usage cheat sheet.
- `/admin` (admin) — all requests, filter by person/status.

### Grouping (never mix directions) — modelled on kx-tess `/dashboard`
Reference: `../../kraftedxlabs/kx-tess/src/services/personal-dashboard.ts` (+ its tests),
`src/app/(app)/dashboard/{dashboard-client,dashboard-group,dashboard-task-card}.tsx`, `delegated-overview/`.
"To me" and "I asked" are never interleaved in one list anywhere (web, bot, MCP). Buckets are **verbs** that say why an
item is there, in a **fixed order** (never sorted by count). Grouping is a pure, unit-tested service function
`groupInbox(requests, now)` / `groupRaised(requests, now)` in `src/services/grouping.ts`. One day convention: IST
(Asia/Kolkata) calendar days everywhere.
- `/inbox` (To me): **New** (open, assignee hasn't opened it yet — track `assignee_seen_at`), **Act** (open/doing, due
  overdue/today/tomorrow or undated), **Upcoming** (open/doing, due after tomorrow), **Waiting** (waiting; custom label is
  the reason), **Done** (done/declined in last 14 days, collapsed by default).
- `/raised` (I asked): stat tiles first in fixed order — **Overdue** (only red one), **Open**, **In progress**,
  **Waiting**, **Done this week**; tapping a tile filters the list. Then sections **Overdue**, **Active**, **Waiting**,
  **Recently done** (collapsed), and a **People** strip: who has your requests, people with overdue/waiting items first,
  on-track people behind "Show N more".
- Sort inside every bucket: priority (urgent→low), then due ascending, undated last, then oldest.
- Group header = button: caret + title + count chip; collapsible; **empty buckets render nothing**; all empty → one
  "You're all caught up" state that teaches the bot commands. Show 5 rows per bucket then "Show N more" (+5).
- Row (two lines): title (line-clamp-2); line 2 small metadata that **skips what the bucket header already says**
  (e.g. no due label in Waiting, no status pill in Act): person, custom label/status badge, relative due ("2 days
  overdue", "Due today", "Due tomorrow", "Due in 3 days", "Due 14 Oct"), priority badge only when not normal, group chat
  name last and dimmest, thread/attachment counts. 3px left border by priority (urgent red, high amber, normal blue
  faint, low none). Inbox rows keep the quick "Mark done" with Undo.
- Layout: groups separated by generous spacing and faint separators (not boxed cards), items indented under the header
  text, no sticky section headers. Poll/refresh every 30s while the tab is visible.
- `/with/[username]`: two blocks, "@bob asked you" then "You asked @bob", each grouped the same way.
- `/admin`: grouped by assignee (person headers with open/overdue counts), filters on top.
- Bot: `/mine` lists Act then New then Upcoming (max 10); `/raised` leads with overdue; `/with @bob` replies in the same
  two blocks. MCP `list_requests` returns `{ groups: [{ key, title, items }] }` using the same functions.

## AI titler (`src/lib/ai/titler.ts`)
OpenRouter chat completions (`https://openrouter.ai/api/v1/chat/completions`), model from OPENROUTER_MODEL,
JSON response format. Runs after create/append via Next `after()` so the webhook returns fast. Input: request body
(all messages), requester/assignee names, chat title, today's date (IST), the event context
(`src/lib/ai/context.ts`: general Edge City India context — popup village, dates, venue Riva Beach Resort Mandrem,
common needs) + facts/answered questions from `ai_context`. Output (validated with zod):
`{ title (≤60 chars, imperative, specific), priority, due_at (ISO or null; resolve "tomorrow", "by Friday",
"tonight" against IST today), question (null or one short question that would help title/understand better) }`.
Writes title/priority/due (only if not manually edited — track `title_locked`, `priority_locked`, `due_locked`
flags set when a human edits), stores question into ai_context (status open, request_id) and requests.ai_question.
Records a `title`/`priority`/`due` event via `ai`. Failures → ai_status failed, heuristic title stays.

## MCP server (`/api/mcp`, streamable HTTP, stateless)
Auth: `Authorization: Bearer etm_…` (api_tokens). Acts as the token's person (admins see all).
Tools: `list_requests` (box: inbox|raised|all, status filter, person filter, limit), `get_request` (full: body,
messages with links, attachments as signed public URLs, timeline, ai_question), `update_status` (status, custom
label, note), `add_comment` (text, notify bool), `create_request` (assignee username, text), `set_due`,
`set_priority`, `whoami`. Tool descriptions say images are public URLs the client can fetch. Server instructions
explain the model. Use `@modelcontextprotocol/sdk` or the same server package eci-events-mcp uses; keep it
dependency-light.

## Iterations (each one is usable on its own)
1. Core: login, bot create/append/reply/mention, lists, detail, statuses, comments, notifications, Telegram-proxied
   images.
2. AI titler + priority/deadline detection + context memory page.
3. MCP + API tokens. (Future: R2 mirror of attachments when R2_* env set; until then Telegram proxy URLs work.)
