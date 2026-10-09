# web-admin: /admin (all requests), /admin/activity (audit log), /settings

Status: done
Branch: task/web-admin   Last commit: see `git log -1 task/web-admin`

## Done
- `/admin`: every request, newest first. Filters: person (requester or assignee), chat, and status chips (Open · Done & declined · All with counts, plus Doing / Waiting / Declined). Pages of 100 (Newer/Older). Rows show #id, title, status pill, requester → assignee, chat, age, due date and photo count. The whole row opens `/r/[id]`.
- `/admin/activity`: the global audit_log, newest first, 50 per page. Filter by action or by who acted, using dropdowns. Clicking an actor or an action chip on a row also filters. Rows link to the entity: request → `/r/<id>`, ai_context → `/context`.
- Both admin pages call `notFound()` for anyone who is not an admin (checked: asha gets 404, devadmin gets 200). Logged-out visitors go to `/?next=…`.
- `/settings`: account card (name, @username, Admin tag, Log out), a short bot cheat sheet with 8 rows taken from SPEC "Telegram bot" (docs/BOT.md does not exist yet), and the `<McpAccess/>` slot under the heading "AI agents (MCP)".
- Forms are plain GET forms with native selects, so they work without JS and are easy to use on phones. No horizontal scroll at 390px.
- Screenshots: `docs/screenshots/web-admin-{admin,admin-filtered,activity,settings}-{390,1280}.png`.

## Tests
- New: `src/services/__tests__/admin.test.ts`, 3 tests, written first and seen failing:
  - listAll by chatId: only that chat's requests come back, and counts follow the filter.
  - adminFacets is admin-only and returns the people on requests plus chats with counts.
  - audit.facets returns each action once and each actor once.
- `pnpm test`: 10 files, 46 tests pass in 6.0s. tsc is clean. lint shows only the old tokens.ts warning.

## Open issues
- **Shared service changes (additive, the integrator should reconcile):**
  - `src/services/requests.ts`: `ListFilter.chatId?: number`, applied in `list()`. New `adminFacets(db, actor) -> {people, chats:{chatId, chatTitle, count}[]}`, admins only.
  - `src/services/audit.ts`: new `facets(db) -> {actions: string[], actors: {personId, label}[]}`.
- The layout does not pass `current` to `<Shell>`, so the header nav never highlights the current page. That belongs to whoever owns the layout or Shell.
- The settings page puts its own "AI agents (MCP)" heading above `<McpAccess/>`. The MCP task should not add a second top-level heading inside it.
- With no TELEGRAM_BOT_USERNAME, the cheat sheet shows "@bot" and hides the "Open @bot" link.
- Activity entity links cover request and ai_context only. person and token rows have no link, because there is no person page for users without a username.
- The actor filter only lists people who have acted (actor_person_id). System and AI rows can't be filtered by actor.
- ponytail: the counts on the status chips ignore the status itself (open, done and all are counts under person/chat). Doing, Waiting and Declined have no counts, because the service only returns three.
- The hydration-mismatch warnings in the dev log are `caret-color` styles that Playwright injects into inputs on `/r/[id]`. They do not come from these pages.

## Files owned
- src/app/(app)/admin/page.tsx, src/app/(app)/admin/activity/page.tsx, src/app/(app)/admin/_ui.tsx (new)
- src/app/(app)/settings/page.tsx
- src/services/__tests__/admin.test.ts (new); additive edits to src/services/requests.ts, src/services/audit.ts
- docs/screenshots/web-admin-*.png, docs/progress/web-admin.md
