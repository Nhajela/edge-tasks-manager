# Edge Tasks Manager — spec

A Telegram-first task sheet for Edge City India (community project by @HiiNaman, Oct 11 – Nov 1 2026, Mandrem, Goa).
People raise **requests** (tasks) for other people from any Telegram group the bot is in. Each person gets a
dead-simple web dashboard: requests **to me** (inbox) and requests **I raised** (outbox). AI agents read and update
requests over MCP.

Reference implementation to copy patterns from: `../eci-travel-coop` (Next 16, Neon + drizzle, Telegram login,
bot webhook, UI tokens/components). Copy the Telegram login flow **exactly** (login_codes table, /api/auth/start,
/api/auth/poll, /login?code= confirm page, bot `/start <code>` → "Yes, log me in" callback, magic links, HMAC
session cookie). MCP reference: `../eci-events-mcp/src/mcp`.

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
  chat_id, message_id, from_id → people, text, link, kind (`original|append`), created.
- `request_events`: timeline — request_id, actor_id → people (nullable for system/AI/MCP), kind
  (`created|status|comment|append|title|priority|due|assignee`), text, data jsonb, via (`telegram|web|mcp|ai`),
  created. Comments and status updates are events.
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
- Mention: `@<bot> @bob please …` or `@<bot> …` works exactly like `/request …` (also when replying).
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
