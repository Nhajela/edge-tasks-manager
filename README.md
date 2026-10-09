# Edge Tasks Manager

A Telegram-first task sheet for Edge City India (Mandrem, Goa, 11 Oct – 1 Nov 2026). Anyone can ask anyone for
something from any Telegram group the bot is in. Each person gets a simple web dashboard: **To me** (inbox) and
**I asked** (raised). AI assistants can read and update requests over MCP.

Community project, not an official Edge City app. The spec is [docs/SPEC.md](docs/SPEC.md).

| Inbox | Request with its reply thread | Landing |
| --- | --- | --- |
| ![inbox](docs/screenshots/final/inbox-390.png) | ![detail](docs/screenshots/final/detail-with-thread-390.png) | ![landing](docs/screenshots/final/landing-390.png) |

More in [docs/screenshots/final/](docs/screenshots/final/) (390px and 1280px).

## Bot commands

| You type | What happens |
| --- | --- |
| `/request @ben fix the projector in the dome` | New request from you to @ben. The bot replies "📝 #12 for @ben: …" with a dashboard link and DMs Ben if he has started the bot. |
| `/request get more chairs for the talk` | No @person: the request goes to the organiser (superadmin). |
| Reply to someone's message with `/request` | They asked, you take it on: requester = the author, assignee = you. Their text and photo become the request. |
| Reply with `/request @ben two 20L cans please` | Their message goes to @ben. Your extra text is added as a note. |
| `@EdgeTasksBot @ben bring extension cords` | Same as `/request`, if the bot mention comes first. "thanks @EdgeTasksBot" is ignored. |
| `@EdgeTasksBot @ben` (nothing else) | The bot asks "What should @ben do?". Reply to that with the details. |
| Photo with caption `/request @ben the shelf fell off` | The photo is attached to the request. |
| Reply to a message with `/append` (or `/add`, `/more`) | Adds that message to its author's latest open request. `/append 12` picks #12. |
| Plain reply to the bot's "#12 for @ben" message | Added to #12. |
| `/mine` · `/raised` · `/with @ben` | Your open requests: to you, from you, between you and Ben. |
| `/status 12` · `/done 12` | One request's status · mark it done (assignee, requester or admin). |
| `/start` · `/help` | Log in to the dashboard · the cheat sheet. |

### Reply threads

Any reply, at any depth, to a message tied to a request joins that request's thread on the web: the original
message, the command, an appended message, the bot's confirmation, or a message already in the thread. No command
needed. The request page shows the thread as a flat chat with a "↳ replying to @ben: …" quote on each message and an
"Open in Telegram" link. Thread replies don't ping anyone on Telegram.

Telegram only delivers plain replies between people to a bot whose **privacy mode is off** (or which is a group
admin). In BotFather: `/setprivacy` → pick the bot → **Disable**. Do this before adding the bot to groups (or
re-add it afterwards). Commands, mentions and replies to the bot's own messages work either way. The bot warns the
superadmin when it joins a group where it can't read messages.

## Setup

1. **Neon**: create a project and a `dev` branch. Put the dev branch URL in `DATABASE_URL` and main in
   `DATABASE_URL_PROD` in `.env.local` (copy [.env.example](.env.example)). Then `pnpm install` and `pnpm db:push`
   (and `pnpm db:push:prod` for production).
2. **BotFather**: `/newbot`, copy the token into `TELEGRAM_BOT_TOKEN`, set `TELEGRAM_BOT_USERNAME` and
   `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`. Then `/setprivacy` → **Disable** (see above).
3. **Env**: fill in `.env.local`. `SESSION_SECRET` and `TELEGRAM_WEBHOOK_SECRET` are long random strings
   (`openssl rand -hex 32`). `SUPERADMIN_USERNAME` is the organiser; set `SUPERADMIN_TELEGRAM_ID` too, because a
   numeric id can't be re-claimed like a username. `OPENROUTER_API_KEY` is optional (without it, titles come from the
   first words of the message).
4. **Vercel**: import the repo, add the same env vars (production `DATABASE_URL` = Neon main), set
   `NEXT_PUBLIC_SITE_URL` to the site URL, and deploy.
5. **Webhook**: `pnpm bot:setup https://<your-site>` points the bot at `/api/telegram` and sets its commands. Safe to
   re-run.

Local development uses the Docker Postgres on `localhost:5545`, never Neon. See [docs/DEV.md](docs/DEV.md). With no
bot token, outgoing messages go to `$TMP/edge-tasks-outbox.jsonl` instead of Telegram.

## Tests

```sh
pnpm test-db     # (re)create the local Postgres container etm-test-pg on :5545, if it's missing
pnpm test        # unit + DB tests (vitest, parallel; each worker gets its own clone of a template database)
pnpm typecheck && pnpm lint
pnpm e2e         # end to end, about 25s (SHOTS=1 pnpm e2e also saves docs/screenshots/final/)
```

`pnpm e2e` (`scripts/e2e.mjs`) makes a fresh local database `etm_e2e`, starts `next dev` on :3400 with no bot token
and no AI key, and drives the bot with `scripts/sim-webhook.mjs` scenarios (request, reply-request, mention,
mention-pending, append, photo, thread-chain). Then in Chrome (Playwright) it logs in as the assignee, opens the
request from the inbox, checks the thread and its reply quotes, sets Doing, comments, and marks it done. It checks
the requester's I asked page, the requester's notification in the dev outbox, the audit rows, `/admin/activity`, and
MCP `list_requests` / `get_request` with a token made on `/settings`. Needs Google Chrome installed.

## MCP (AI assistants)

Make a token on `/settings` (shown once; it acts as you). Then, for Claude Code:

```sh
claude mcp add --transport http edge-tasks https://<your-site>/api/mcp --header "Authorization: Bearer etm_…"
```

Other clients: streamable HTTP at `https://<your-site>/api/mcp` with the header `Authorization: Bearer etm_…`.
Tools: `whoami`, `list_requests`, `get_request`, `create_request`, `update_status`, `add_comment`, `set_due`,
`set_priority`. Photos come back as signed public URLs the client can fetch. claude.ai connectors need OAuth, which
the server doesn't support yet.

## Roadmap

- **R2 for photos**: copy Telegram files to Cloudflare R2 (`attachments.r2_key`) so images outlive Telegram's file
  links. The `R2_*` env vars in `.env.example` are for this and are not used yet.
- Verb-bucket grouping for the inbox, raised page, bot and MCP (SPEC "Grouping").
- Status commands from anywhere in a thread: `/doing`, `/waiting`, `/decline`, `/reopen` (SPEC "Status from anywhere
  in the thread").
- OAuth for the MCP server, so claude.ai can connect.
