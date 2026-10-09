# bot-scripts: bot setup script, local webhook simulator, bot docs

Status: done
Branch: task/bot-scripts   Last commit: (see git log)

## Done
- `pnpm bot:setup https://<site>` (scripts/setup-bot.mjs): setWebhook with secret + allowed_updates
  (message, edited_message, callback_query, my_chat_member), name "Edge Tasks", 8 commands, long/short descriptions,
  getMe/getWebhookInfo, prints the BotFather /setprivacy -> Disable reminder when `can_read_all_group_messages` is false,
  exits 1 if any call fails.
- `node scripts/sim-webhook.mjs <baseUrl> <scenario> [requestId]`: realistic updates from seeded fake people
  (91000000xx) in a fake supergroup, correct UTF-16 entities, photos, reply_to chains. Scenarios: request-at,
  reply-request, mention, mention-pending, append, photo, thread-chain, list, done. Reads the bot's replies (fake ids)
  from the dev outbox so it can reply to the bot. Refuses non-localhost URLs. Sends the secret header if set.
- docs/BOT.md: setup, every command with examples, mentions, how replies thread, privacy mode, adding to groups,
  local simulation.

## Tests
- tests/sim-webhook.test.ts (unit, 12 tests): every scenario yields fake ids, the sim chat, unique message ids, and
  entity offsets that point at the right `/command` / `@mention`; thread-chain matches the SPEC chain; append picks
  up the id from the confirmation; photo has caption entities and 3 sizes.
- CLI smoke against a dummy local server: request-at posts with the secret header, usage and localhost refusal work.
- `pnpm test`: 10 files, 55 tests, 8.4s (11.5s wall). tsc clean. eslint clean on the new files.

## Open issues
- Not run against the real webhook: `/api/telegram`, parseUpdate and handleIntent are still stubs on this base.
  Scenarios that read a bot reply (mention-pending, append, thread-chain, done without an id) need the handler to
  send replies with `replyTo` = the triggering message id (as `sendMessage` does via `opts.replyTo`) before the
  webhook returns; otherwise the sim waits 3s and errors.
- The `done`/`append` scenarios take the request id from the first `#<n>` in the confirmation text.
- setup-bot does not pass drop_pending_updates (re-running never discards real updates).
- No setup-bot run against the real Bot API (needs the token; owner's call).

## Files owned
- scripts/setup-bot.mjs, scripts/sim-webhook.mjs, docs/BOT.md, tests/sim-webhook.test.ts, docs/progress/bot-scripts.md
