# Progress

One line per task. The details are in each task's file under `docs/progress/`.

| Task | Status | Notes |
|------|--------|-------|
| infra-ci-files | done, merged | [progress/infra-ci-files.md](progress/infra-ci-files.md): safe inline file types, CI workflow, test DBs named per run |
| bot-parse | done, merged | [progress/bot-parse.md](progress/bot-parse.md): parseUpdate, 65 table tests |
| bot-handlers | done, merged | [progress/bot-handlers.md](progress/bot-handlers.md): handleIntent for create, append, threads, prompts and lists |
| bot-route | done, merged | [progress/bot-route.md](progress/bot-route.md): /api/telegram, login and status callbacks, membership warning |
| bot-scripts | done, merged | [progress/bot-scripts.md](progress/bot-scripts.md): setup-bot, sim-webhook, docs/BOT.md |
| ai-titler | done, merged | [progress/ai-titler.md](progress/ai-titler.md): OpenRouter titler, confirmation edit |
| mcp-server | done, merged | [progress/mcp-server.md](progress/mcp-server.md): stateless /api/mcp, Bearer tokens, 8 tools |
| web-shell | done, merged | [progress/web-shell.md](progress/web-shell.md): landing page, shell, phone tab bar |
| web-lists | done, merged | [progress/web-lists.md](progress/web-lists.md): /inbox, /raised and /with sections |
| web-detail | done, merged | [progress/web-detail.md](progress/web-detail.md): /r/[id] (renders AiQuestionCard) |
| web-admin | done, merged | [progress/web-admin.md](progress/web-admin.md): /admin, /admin/activity, /settings |
| ai-context-ui | done, merged | [progress/ai-context-ui.md](progress/ai-context-ui.md): /context page, AiQuestionCard |
| mcp-settings-ui | done, merged | [progress/mcp-settings-ui.md](progress/mcp-settings-ui.md): token create, copy and revoke, setup snippets |

## Integration notes (2026-10-09)

- Merged in the order above with `--no-ff`. After each merge, tsc and `pnpm test` passed. At the end: 25 files, 228 tests, about 6s. `pnpm build` passes. `pnpm lint` gives 0 errors and 1 warning (`_h` in services/tokens.ts).
- Conflicts:
  - `services/types.ts`: OutgoingMessage.buttons was added the same way on both sides. Only the comment differed.
  - `services/requests.ts`: ListFilter takes `chatId` (web-admin) and ListItem takes `threadCount` (web-lists). Both are kept.
- Seam fixes:
  - The bot's "#12 for @bob" confirmation now uses `confirmationMessage()` from services/titler. The AI edit then keeps the same wording and the same "Open the dashboard" button.
  - The On it and Done buttons on the assignee DM now come only from `services/notifications`. bot-handlers added them a second time; that copy is removed.
  - `components/Placeholder.tsx` was no longer used, so it is deleted.
- Wiring:
  - `/api/telegram` uses the real `parseUpdate` and `handleIntent`.
  - Button presses (`login:` and `st:`) go to `lib/bot/callbacks.ts`, and `my_chat_member` goes to `lib/bot/membership.ts`. Both skip parse.
  - `/start` goes to `callbacks.handleStart`.
  - `/r/[id]` renders AiQuestionCard, `/settings` renders McpAccess, and nav highlighting uses `usePathname`.
- History: the web-admin merge landed inside the owner's commit d9aed80 ("Spec: status commands from anywhere..."). That commit was made in this working tree while the merge was staged. Its content is correct.

## Unresolved

- **Spec changes made after the tasks were cut.** None of these is built yet:
  - c04878d: verb-bucket grouping. Needs `services/grouping.ts`, `assignee_seen_at`, stat tiles, the People strip, and grouped output from MCP and the bot.
  - d9aed80: status commands from anywhere in a thread. Built in verify round 1 (below).
- **Duplicate bot code.** `handlers.ts` still has branches for `start`, `login-confirm`, `status-button` and `membership` that the route never reaches. The route uses callbacks.ts and membership.ts. Delete one copy. The callbacks.ts copy is stricter: it allows only the assignee and ignores a double tap.
- A wrong webhook secret returns 401, not 200.
- After a button tap, the DM loses its formatting.
- The bot's `/with` reply is not grouped.
- The inbox Done section has no 14-day limit.
- Not tested against the real system:
  - The simulator has not been run against the real webhook.
  - `setup-bot.mjs` has not been run against the real Bot API.
  - CI has never run on GitHub.
  - The live OpenRouter smoke test has not been run.
- `.env.example` is missing `R2_*` and `FILES_SECRET`.
- Mirrored R2 URLs are public and never expire.
- claude.ai cannot use the MCP server: its connectors need OAuth.
- Detail page: anyone who can see a request can rename it. The SPEC says only the assignee or an admin can.
- The databases `etm_mcp_server` and `etm_web_admin` were left on :5545.

## Verify round 1 (2026-10-09)

Reviewer findings, each checked against the code. Every fix has a failing test written first.

| # | Finding | Outcome | Why / what changed |
|---|---------|---------|--------------------|
| 1 | `replyOf` drops replies in plain supergroups | fixed | Telegram sets `message_thread_id` to the reply chain's root outside forums too. A reply is now ignored only when `is_topic_message` and it points at the topic root, or the target has `forum_topic_created`. Parse tests cover plain-supergroup replies to the chain root (human and bot). |
| 2 | Status commands missing; `@bot done` creates a request | fixed | New `status` intent: `/done /doing /waiting /decline /reopen` and a leading `@bot done` / `@bot on it`. Resolves the request from an explicit id or the reply chain, then calls `setStatus` with the note (`/waiting` reason = custom label). A non-party replying in the thread gets "Only @assignee or @requester can change #N" and their message lands in the thread. An explicit `/done 12` from outside gets the generic error, so ids can't be probed for names. In a thread, a leading number is part of the note unless written `#12` or alone. The assignee's bare "done"/"✅" thread reply gets a "Mark #N done?" button (`st:N:done`). A replied-to bot message is never a request source, so a bot can't be the requester. |
| 3 | Reply chains break at stickers, voice notes etc. | fixed | A reply with no text, photo or document is stored as a thread message with a marker ("(sticker)", "(voice note)", …), so later replies still chain. A media-only reply to the bot itself is still ignored. |
| 4 | `/append` on a thread message is silent and does nothing | fixed | `onAppend` first uses the request the replied-to message is tied to. `requests.append` promotes a `thread` row of the same request to `append` and extends the body (one `request.append` audit row). A message tied to another request gets "That message is already in #N"; a retry stays silent. |
| 5 | Any reply to any tied bot message appends | fixed | Only a reply to the request's `bot_confirm` message appends; replies to the bot's other messages are thread messages (no body change, no bot reply). |
| 6 | `/start` in a group handled as DM `/start` | fixed | `parseUpdate` returns `start` only in private chats, so `started_bot` is never set from a group. |
| 7 | `mergeInto` misses `pending_prompts` | fixed | Moves `requester_id`, `assignee_id`, `created_by_id` before deleting the placeholder. DB test merges a placeholder referenced by a prompt. |
| 8 | Replies to a used/expired prompt are lost | fixed | `findRequestByTelegramMessage` resolves a prompt message to the request created from it (same chat + mention message), so later replies thread. A reply to an expired, unused prompt gets "That prompt expired. Send /request @bob … again." (`prompts.find` read). |
| 9 | `safeNext` allows `/	/evil.com` | fixed | Rejects control characters and backslashes. Unit tests for tab, newline, CR. |
| 10 | Stale session cookie moves usernames | fixed | `actorFromSession` no longer passes the cookie's username and no longer re-upserts on a username mismatch. Usernames come only from Telegram updates. |
| 11 | `/start` in a group sets `started_bot` | fixed | Same fix as 6. |
| 12 | Creator who is not a party can change status | fixed | `canManage` is now requester, assignee, admin, system or AI. `canView` still includes the creator. |
| 13 | `mergeInto` FK violation (duplicate of 7) | fixed | Same fix as 7. |
| 14 | AI `setField` can overwrite a lock set mid-flight | fixed | AI writes put `lock = false` in the UPDATE's WHERE; no row means `changed: false` and no audit row. Tested with `tests/helpers/racy.ts`, which runs a human write between the read and the write. |
| 15 | Titler writes outside the try; question length unbounded | fixed | All writes after the model call are in the same try (failure -> `ai_status` failed). The model's question is clipped to 500 chars. |
| 16 | `create` not race/retry safe | fixed | The `request_messages` insert uses `returning()`. If another run claimed a message first, the new request is deleted (its messages cascade) and the winner is returned as a duplicate, with no audit row. Tested with the racy helper. |

Also: `setup-bot.mjs` registers the new commands; `/help` and `/settings` list them.
Checks: tsc 3s, lint 9s (0 errors, 1 old warning), `pnpm test` 274 tests in 7.1s, `pnpm build` 15s, `pnpm e2e` passed in 30.8s.


## Verify round 2

Five reviewer findings, each confirmed in the code first. Every fix has a failing test written first.

| # | Finding | Outcome | Why / what changed |
|---|---------|---------|--------------------|
| 1 | A successful status command in a thread is never stored | fixed | `onStatus` stores the command message with `addThreadMessage` before `setStatus` (shared with the forbidden path). A reply to `/waiting need quote` now chains to the request. |
| 2 | Status commands and `@bot @bob` have no redelivery dedupe | fixed | Thread path: if the command message is already stored, return `status.duplicate` (no audit row, no ping, no reply). Explicit `/done 12`: same status and no note means `status.unchanged`, with no audit row or notifications (one repeat reply, like the DM buttons). `onPrompt`: a prompt already made from this chat + message returns `prompt.duplicate` (new `prompts.findBySource`). |
| 3 | Media-only replies to the bot's own messages are dropped | fixed | `parseUpdate` turns a reply to the bot with no text/photo/document into a `thread` intent with the media marker ("(sticker)", "(voice note)"). It never becomes a `pending-reply`, so a placeholder can't claim a prompt or append to the body. |
| 4 | Anyone can claim another person's "What should @bob do?" prompt | fixed | `prompts.consume` only matches when the replier is the prompt's requester. Others replying to a live prompt get `prompt.not-requester` (silent, nothing stored); the requester can still answer. |
| 5 | Web visits flip `started_bot` back to true without audit | fixed | `actorFromSession` upserts only when the person does not exist yet. Only `/start` (audited) sets it true again. |

Checks: tsc 14s, lint 21s (0 errors, 1 old warning in `tokens.ts`), `pnpm test` 281 tests in 11.3s, `pnpm build` 26s, `pnpm e2e` passed in 48.5s.

## Verify round 3

Three reviewer findings, all confirmed in the code. Each fix has a failing test written first (`handlers.test.ts` "verify round 3", plus one `parse.test.ts` case).

| # | Finding | Outcome | Why / what changed |
|---|---------|---------|--------------------|
| 1 | Thread status commands have no "status unchanged" guard | fixed | `onStatus` checks `before.status === i.status && !note` on both paths. In a thread the message is still stored (so replies chain, and a redelivery returns `status.duplicate`), but there is no `request.status` row and no ping. The reply is `status.unchanged`. |
| 2 | Attachments on a status command are dropped | fixed | `statusIntent` carries `attachments: attachmentsOf(message)`. The command message and its media are stored on both the thread path and the explicit `/done 12` path. The `result_*` deliverable card from the SPEC is not built yet, so the photo appears as an ordinary attachment. |
| 3 | A thread status command writes two audit rows | fixed (partly) | `setStatus` takes an optional `message`. It stores the command message and attachments and writes one `request.status` row with `data.messageId`. `request.thread` is written only on the forbidden path ("their message still lands in the thread") and on the unchanged path. Not done: the message is still stored with kind `thread`, so it still shows as a bubble and counts in `threadCount`. A separate `command` kind needs a schema check change and a prod `db:push`, plus a "system line" thread renderer. Left for a deliberate UI pass. |

Checks: tsc clean, lint 0 errors (1 old warning in `tokens.ts`), `pnpm test` 285 tests in 9.9s, `pnpm build` 17.5s, `pnpm e2e` passed in 29.7s.
