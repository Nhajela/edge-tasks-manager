# Edge Tasks bot

The bot turns Telegram messages into requests (tasks) on the web dashboard. It works in any group it is added to and
in a direct message (DM). Examples use `@EdgeTasksBot`; use your bot's real username.

## Setup (owner, once per bot)

1. Create the bot with @BotFather and put `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
   `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` and a random `TELEGRAM_WEBHOOK_SECRET` in `.env.local` and in Vercel.
2. **Turn privacy mode off**: @BotFather → `/setprivacy` → pick the bot → **Disable**. See [Privacy mode](#privacy-mode).
3. After deploying, run `pnpm bot:setup https://<site>`. It:
   - sets the webhook to `https://<site>/api/telegram` with the secret (Telegram sends it in the
     `X-Telegram-Bot-Api-Secret-Token` header) and `allowed_updates` = `message`, `edited_message`,
     `callback_query`, `my_chat_member`;
   - sets the name "Edge Tasks", the command menu below, and the long and short descriptions;
   - prints `getMe` and `getWebhookInfo`, and a reminder if privacy mode is still on.

   It is safe to re-run. It exits non-zero if any Bot API call fails.

## Commands

| Command | What it does |
| --- | --- |
| `/request @bob fix the projector` | New request from you to @bob. Body: "fix the projector". |
| `/request fix the projector` | No @someone: the request goes to the organiser. Works the same in a DM. |
| reply to a message with `/request` | "I'll take this": requester = the person who wrote that message, assignee = you. Their text (or photo caption) is the body. Their photo is attached. |
| reply with `/request @bob two 20L cans` | Requester = the person who wrote that message, assignee = @bob. The extra text is saved as a note. |
| `/request@EdgeTasksBot …` | Same as `/request` (Telegram adds the bot's name when you pick it from the menu in a group). |
| `/append` (also `/add`, `/more`) as a reply | Adds the replied message to the most recent open request **raised by its author** (this chat, last 24h, else anywhere). |
| `/append 12` as a reply | Adds the replied message to #12. |
| `/append more details` as a reply to the bot's "#12" message | Adds the text to #12. |
| reply with `/log` | **Quiet.** Already a request: tells you its number. A reply to a request's message: joins that thread. Anything else: a new request from its author to you. Nothing in the group, nobody pinged; your `/log` is deleted and only you get a DM. |
| `/new_request …` | **Quiet** `/request`: same rules, only you get a confirmation (DM), no DM to the assignee at creation. |
| reply with `/new_request_for_me` | **Quiet**: their message becomes a request from them to you. |
| forward a message to the bot (in private) | It shows who it's from and asks: **New request** (quiet, from its original author to you) or **➕ add to** one of your open requests (theirs first). Use it for messages `/log` can't see: from before the bot joined the group, or from another chat. |
| `/mine` | Your open requests (assigned to you). |
| `/raised` | Open requests you raised. |
| `/with @bob` | Open requests between you and @bob, both ways. |
| `/status 12` | Status of #12. |
| `/done 12` | Marks #12 done. The assignee, the requester or an admin can do this. |
| `/help` | Short help. |
| `/start` | In a DM: welcome, or log in when opened from the website's login button. |

Lists show up to 10 items as `#id title — status · due`, with a button to open the dashboard.

When the bot creates a request, it replies to your message with "📝 #12 for @bob: <title>" and a link to the request.
If @bob has started the bot, it also sends them a DM. The title is a quick guess at first. The bot edits the message
when the AI title is ready.

### Mentions (no command needed)

A message that **starts** with the bot's @username works like `/request`:

- `@EdgeTasksBot @bob fix the projector`: request to @bob.
- `@EdgeTasksBot fix the projector`: request to the organiser.
- As a reply: `@EdgeTasksBot` alone means "from the author of that message, to me". `@EdgeTasksBot @bob` means "to @bob".
- `@EdgeTasksBot @bob` with nothing else: the bot asks "What should @bob do? Reply to this with the details". Reply to
  that message within 1 hour and your reply becomes the request.
- `@EdgeTasksBot` alone, not as a reply: the bot sends a short help message. Nothing is created.
- The bot ignores a mention in the middle of a sentence ("thanks @EdgeTasksBot").

More rules:

- The first @someone right after the command or mention is the assignee. Other @names stay in the text.
- People without a username can be picked from Telegram's mention list (a `text_mention`). They can be the assignee too.
- A photo with the caption `/request @bob the shelf fell off` creates a request with the photo attached.
- The bot ignores messages from other bots. If Telegram delivers the same message twice, only one request is created.

## How replies thread

You do not need a command to add to a conversation. **Any reply** to a message that belongs to a request joins that
request's thread on the web page. This works at any depth.

A message belongs to #12 if it is:

- the `/request` command, or the message it replied to;
- a message added with `/append`;
- one of the bot's messages about #12 (the "📝 #12" reply, a DM, a status message);
- a reply to any of the above, or a reply to such a reply, and so on.

Example: the bot confirms #12 → Asha replies to it → Ben replies to Asha → Asha replies to Ben → Chitra replies to
Ben. All four messages are in #12's thread, in order. Each shows "↳ replying to <name>".

- A plain reply to the bot's "📝 #12" message is added to #12's **body** (like `/append`). This can change the title.
- A reply further down the chain is a **thread** message. It does not change the body or the title, and nobody gets a
  Telegram ping for it. The requester and assignee see it on the dashboard.
- Messages that are not connected to a request are ignored and never stored.

## Privacy mode

Telegram bots start with privacy mode **on**. In a group, a bot in privacy mode only receives:

- commands (`/request`, `/mine`, …);
- messages that mention it (`@EdgeTasksBot …`);
- replies to the bot's own messages.

Every command and mention flow above works with privacy mode on. **Reply threads do not**: when Ben replies to
Asha's message, Telegram does not send that reply to the bot. To fix this, do one of these:

- **Disable privacy mode** (recommended): @BotFather → `/setprivacy` → the bot → **Disable**. Privacy mode is set when
  the bot joins a group. If the bot is already in a group, remove it and add it again.
- Or make the bot an **admin** of the group. Admins receive all messages.

`pnpm bot:setup` prints whether privacy mode is off (`getMe` → `can_read_all_group_messages`). When the bot is
added to a group where it cannot read messages, it sends a warning to the organiser.

## Adding the bot to a group

1. In the group: group name → **Add members** → search the bot's @username → Add. Or, in a DM with the bot, tap
   its name → **Add to Group or Channel**.
2. If privacy mode is still on, make the bot an admin (no extra admin rights needed), or turn privacy mode off and
   add the bot again.
3. Try it: `/request @yourself test` in the group. The bot should reply with "📝 #… for @…".
4. For the quiet commands (`/log`, `/new_request…`) to delete your command message, make the bot an admin with
   **Delete messages**. Without it they still work, but the command stays visible.
5. Ask members to open the bot once and tap **Start**. After that they get DMs when someone asks them for something
   or when their request is done. People who never started the bot get notified in the group instead.

Supergroups get "Open in Telegram" links on each message. Basic groups and DMs cannot have message links. Telegram
turns a basic group into a supergroup when you change some settings, such as making the history visible to new
members.

## Trying it locally (no Telegram)

Without a bot token, the dev server does not send anything. It writes each outgoing message to
`$TMP/edge-tasks-outbox.jsonl`, with a fake message id. `scripts/sim-webhook.mjs` posts realistic fake updates to
your local server. It uses the seeded people (asha, ben, chitra, Farid; fake ids 91000000xx) in a fake supergroup.
It reads the bot's replies back from the outbox, so it can reply to the bot's messages.

```sh
node scripts/dev-db.mjs etm_dev_bot
DATABASE_URL=postgres://postgres@localhost:5545/etm_dev_bot node scripts/seed-dev.mjs
DATABASE_URL=postgres://postgres@localhost:5545/etm_dev_bot pnpm dev --port 3102
# in another shell (--env-file passes TELEGRAM_WEBHOOK_SECRET / TELEGRAM_BOT_USERNAME if set):
node --env-file=.env.local scripts/sim-webhook.mjs http://localhost:3102 thread-chain
```

| Scenario | What it sends |
| --- | --- |
| `request-at` | `/request @ben fix the projector…` from Asha |
| `reply-request` | Asha replies `/request` to Ben's message, then `/request@bot @ben …` as a reply to Chitra's |
| `mention` | `@bot @ben …`, `@bot …` (to the organiser), `@bot Farid …` (text_mention), and an ignored "thanks @bot" |
| `mention-pending` | `@bot @ben` alone, then Asha replies to the bot's prompt with the details |
| `append` | create, `/append` as a reply, `/add <id>` as a reply, and a plain reply to the confirmation |
| `photo` | a photo with a `/request` caption, and `/request` as a reply to a photo |
| `thread-chain` | the SPEC chain: confirmation → Asha → Ben → Asha, and Chitra replying to Ben |
| `list` | `/mine`, `/raised`, `/with @ben`, `/status <id>`, `/status@bot <id>`, `/status`, `/help` (pass the id as a 3rd argument; default 1) |
| `done` | create as Asha for Ben, then Ben sends `/done <id>` (or pass an id to only send `/done`) |

The script only posts to `localhost`. Each run uses new message ids, so the dedupe check does not skip re-runs.
