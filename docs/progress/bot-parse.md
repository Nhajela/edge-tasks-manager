# bot-parse: parseUpdate(update, ctx) -> Intent, per SPEC "Telegram bot" + "Reply threads"

Status: done
Branch: task/bot-parse   Last commit: see `git log -1 task/bot-parse`

## Done
- `/request` (+ `/request@bot`, captions): `@bob` / text_mention assignee, no @ -> superadmin, reply form (requester = replied author, assignee = replier or named @person, extra text -> `note`, replied text/caption -> body)
- Leading `@bot` mention = same rules (`via: "mention"`); mid-sentence mention ignored; bare `@bot` -> `help-mention`; `@bot @bob` (no text/reply/attachment) -> `prompt`
- `/append` `/add` `/more` with optional `12`/`#12`; reply to a human -> payload = replied message; reply to the bot or no reply -> payload = the command itself
- Plain reply to our bot -> `pending-reply`; plain reply to anyone else -> `thread` candidate (handler checks membership in the DB); not a reply -> ignore
- `/mine /raised /help /with @bob|reply /status N /done N`, `/start <code>`, `login:<code>` callback, `my_chat_member` -> `membership`
- Largest photo (by area) + document as AttachmentInput with messageId; command message's and source's attachments both kept
- Ignored: edited_message, channel_post, channel chats, no `from`, from any bot, sticker-only, unknown commands, `/cmd@otherbot`

## Tests
- `src/lib/bot/__tests__/parse.test.ts`: 65 table-driven cases (unit project, no DB)
- `pnpm test`: 10 files, 108 tests passed, ~8.6s vitest / ~13s wall. `tsc --noEmit` clean, eslint clean on src/lib/bot.

## Open issues
- `/request` with no text, no reply, no attachment -> `help-mention`; `/request @bob` alone -> `prompt` (same as the mention form). Handlers should treat them identically.
- Forum topics: a message whose `reply_to_message.message_id === message_thread_id` is treated as not a reply (Telegram's implicit topic-root reply).
- `/append` replying to a human with extra text: body = replied text + "\n\n" + extra text.
- `/done` / `/status` without an id give `requestId: null` even when replying to a request message; handler could resolve via findRequestByTelegramMessage if wanted.
- Plain replies to *other* bots become `thread` candidates; handler lookup will just miss.
- No contract changes.

## Files owned
- src/lib/bot/parse.ts
- src/lib/bot/__tests__/parse.test.ts
- docs/progress/bot-parse.md
