# bot-handlers: handleIntent (Intent -> services -> bot replies + effects)

Status: done
Branch: task/bot-handlers   Last commit: see `git log -1 task/bot-handlers`

## Done
- `/request` (command, mention, reply case): creates through `requests.create` and replies in the chat with
  "📝 #12 for @bob: title" plus an Open button. The reply is a reply to the command message, and its id is stored
  with `setBotConfirmation`. The assignee DM effect gets "✅ Done" / "🔄 On it" callback buttons
  (`st:<id>:done`, `st:<id>:in_progress`), and the DM only happens if they started the bot.
  A Telegram retry does nothing. A second `/request` on a message that is already tracked replies "That message is already #12".
- No @ in `/request`: assigned to the superadmin. An empty request gets a usage reply.
- `/append`: works with an explicit id, by replying to a bot message, or by replying to a human message
  (that author's latest open request). The bot replies "➕ Added to #12". With no target it says so.
- Thread capture: any reply to a message tied to a request is stored (kind `thread`, reply_to kept, no ping).
  Replies to unrelated messages are never stored.
- `@bot @bob` sends "What should @bob do?" and creates a pending prompt. The reply to it creates the request.
  Expired or already-used prompts are ignored. A plain reply to a bot message tied to a request appends to it (SPEC).
- `/mine`, `/raised`, `/with @bob`: up to 10 rows, each `#id title — status · due` (custom label, IST due),
  then "…and N more", then a dashboard button. `/status 12` is for participants only. `/done 12` is allowed for
  the requester, assignee or an admin, and the other side is notified. `/help` and the bare-mention help work.
- `/start [code]`: the eci-travel-coop login flow ("Yes, log me in" callback, magic link). Also marks
  `started_bot`. `login-confirm` claims the code and edits the message.
- Membership: if the bot is added as a plain member and getMe says it can't read group messages, the superadmin gets a DM.
- Service errors become a short reply. Thread and membership errors are silent.

## Tests
- `src/lib/bot/__tests__/handlers.test.ts` has 18 DB tests with a capturing notifier and a fake `tg`. It covers
  create/confirm/DM buttons/retry, the organiser default, reply-case body and messages, append (with and without
  a target), the SPEC Asha -> Ben -> Asha -> Chitra chain, prompt + consume + expiry, the list format with the
  10-row cap and IST due, /raised, /with, /status and /done permissions, help, the Done button, and /start.
- `pnpm test`: 10 files, 61 tests, all pass, about 10.7s. `tsc --noEmit` is clean and eslint is clean on the changed files.

## Open issues
- **Contract additions (additive, please reconcile):**
  - `src/lib/bot/types.ts` has a new Intent kind `status-button`
    `{requestId, status: 'done'|'in_progress', callbackQueryId, from, message}`. **bot-parse** must map a
    callback_query with data `st:<id>:done|in_progress` to it. Until then the DM buttons do nothing.
  - `src/services/types.ts`: `OutgoingMessage.buttons` now also accepts `{text, callback_data}`. The login
    prompt and DM buttons go through the Notifier. `telegramNotifier` already passes buttons to `sendMessage(Button[])`.
  - `vitest.config.mts`: `src/lib/bot/__tests__/handlers.test.ts` was added to DB_TESTS. It needs the DB, and
    without this it would run in the unit project.
- `HandlerDeps` has a new optional `tg(method, body)`, which defaults to `lib/telegram` `tg`. It is used for
  answerCallbackQuery, editMessageText and getMe. **bot-route** needs no change.
- Per the contract, a plain reply to the bot's confirmation is an *append* (kind `append`, changes the body and
  re-titles), not a thread message. Replies to humans further down that chain are `thread`. The SPEC thread example
  still holds (all four messages show on the request in order). Say so if the owner wants a reply to the
  confirmation to be thread-only.
- ponytail: anyone who replies to a "What should @bob do?" prompt claims it. The requester stays whoever mentioned
  the bot. Check the replier if this gets abused.
- List and status buttons use plain dashboard URLs, not magic login links (this saves a login_codes row per list).
- Not checked against real Telegram. Tests use the capturing notifier.

## Files owned
- src/lib/bot/handlers.ts, src/lib/bot/replies.ts, src/lib/bot/__tests__/handlers.test.ts
- (shared, additive) src/lib/bot/types.ts, src/services/types.ts, vitest.config.mts
