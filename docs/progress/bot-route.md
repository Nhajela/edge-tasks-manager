# bot-route: Telegram webhook route, callback buttons, /start login, my_chat_member

Status: done
Branch: task/bot-route   Last commit: see `git log -1 task/bot-route`

## Done
- `POST /api/telegram`: secret header checked with timingSafeEqual (missing/wrong/unconfigured -> 401, like
  eci-travel-coop); otherwise always 200, errors logged. callback_query -> callbacks, my_chat_member -> membership,
  everything else parseUpdate -> (`start` -> handleStart | handleIntent) -> `after(runEffects(effects))`.
- `/start <code>`: "Log in to Edge Tasks in your browser?" + "Yes, log me in" button (callback `login:<code>`);
  plain /start or expired code: welcome + single-use magic link. Copied from eci-travel-coop; marks started_bot.
- Login callback: claimCode, answer, edit the prompt into "You're logged in" (+ Continue button on https), or send
  a fresh link when expired.
- Assignee buttons on the assignment DM: "🔄 On it" (`st:<id>:in_progress`) and "✅ Done" (`st:<id>:done`). Only the
  assignee; goes through requests.setStatus (one audit row; a double tap writes none); edits the DM (On it leaves a
  Done button); returns the service's notify effects.
- my_chat_member in a group: DM the superadmin the chat title/id/who; warns with the /setprivacy fix when getMe says
  can_read_all_group_messages=false and the bot is not admin. Sent as a notify effect (after()).

## Tests
- `src/app/api/telegram/route.test.ts` (unit, parse/handlers/callbacks/membership/effects mocked): secret checks,
  dispatch, after() scheduling, always-200 on errors and bad JSON.
- `tests/db/bot-callbacks.test.ts` (DB; Telegram calls mocked): /start prompt + welcome magic link redeems, login
  callback claim/expired/unknown, status buttons (on it -> done, double tap, non-assignee, stranger, unknown id),
  my_chat_member warning matrix and private-chat ignore.
- `pnpm test`: 11 files, 63 tests passed, 11.5s (17s cold). tsc clean, eslint clean on touched files.

## Open issues
- Shared change (additive): `OutgoingMessage.buttons` in `src/services/types.ts` now also allows
  `{text, callback_data}`, and `notifications.decide` "assigned" DM gets the On it / Done buttons before the Open
  link. telegramNotifier already passes them through.
- `start` intents are handled by `handleStart` in the route, not by handleIntent: the bot-handlers task can leave
  `start` unimplemented (or the integrator moves the call). Callback queries and my_chat_member bypass parseUpdate,
  so parse's `login-confirm` / `membership` intents are unused by the route.
- Bad secret returns 401 (as the reference) rather than 200; Telegram always sends the right secret.
- Edited DM text is the plain message text (Telegram drops the HTML formatting in cb.message), escaped.
- Not checked against real Telegram (no live webhook run).

## Files owned
- src/app/api/telegram/route.ts, src/app/api/telegram/route.test.ts
- src/lib/bot/callbacks.ts, src/lib/bot/membership.ts, tests/db/bot-callbacks.test.ts
- shared (additive): src/services/types.ts, src/services/notifications.ts
