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
  - d9aed80: status commands (`/doing`, `/waiting`, `/decline`, `/reopen`, and reply-chain `/done`) from anywhere in a thread.
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
