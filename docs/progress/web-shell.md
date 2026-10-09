# web-shell: landing, app shell + nav, login, EmptyState, loading/error/not-found

Status: done
Branch: task/web-shell   Last commit: (see `git log -1 task/web-shell`)

## Done
- `/` logged out: "Ask anyone at Edge City for something, right from Telegram" with a Telegram-style chat
  (/request @bob, the bot's "#12 for @bob" reply, reply-with-/request, /mine) and Log in with Telegram
  (one LoginButton instance, above the fold on phones). Logged in: redirects to `?next=` or `/inbox` (unchanged).
- App shell: floating glass header pill. Desktop: nav inline (To me, I asked, admin: All, Activity, Context, Settings).
  Phones: icon tab bar floating at the bottom (thumb reach, safe-area aware); header keeps just the brand.
  Marigold badge on "To me" = open inbox count (from `requests.listInbox` counts, in `(app)/layout.tsx`).
  Active item comes from the pathname (`activeHref`: longest matching segment, so /admin/activity lights Activity, not All).
- `EmptyState({title, children?, commands?: CommandKey[]})` teaches the bot with command bubbles; `COMMANDS` and
  `CommandBubble` are exported for reuse (keys: request, organiser, reply, mine, raised, append).
- `(app)/loading.tsx` skeleton (title, chips, 5 rows) rendered inside the shell.
- Login confirm, not-found and error pages were already fine at 390/1280; left as is.
- Screenshots: `docs/screenshots/web-shell-*.png` (landing, inbox as asha and devadmin, admin activity, EmptyState,
  login confirm, not-found; 390px and 1280px).

## Tests
- `src/components/navItems.test.ts`: nav items per role, active-item matching (12 tests).
- `pnpm test`: 10 files, 55 tests, passed in 7.7s (other worktrees were running suites at the same time).
- tsc clean; lint: only the old warning in `src/services/tokens.ts`.

## Open issues
- Shared change: appended a rule to `src/app/globals.css` (`body:has([data-tabbar])` bottom padding on phones) so
  the floating tab bar never covers the footer. Additive; reconcile if another task touches the end of globals.css.
- `Shell` props changed: it now takes `{isAdmin, inboxCount, children}`; the unused `session`, `current`, `wide`,
  `hero` props are gone (only `(app)/layout.tsx` rendered it). Main column is `max-w-3xl` (48rem) for every page under
  `(app)`, aligned with the header; a page that needs wider (admin table) can break out with its own wrapper.
- The layout runs one extra count query per page load (listInbox with limit 1). Fine at this scale.
- Next's dev indicator ("N" bubble) sits over the "To me" tab at 390px in dev only; production has no indicator.
- `src/components/Placeholder.tsx` is still used by pages other tasks own; delete once they land.

## Files owned
- src/app/page.tsx, src/app/(app)/layout.tsx, src/app/(app)/loading.tsx
- src/components/Shell.tsx, src/components/Nav.tsx, src/components/navItems.ts (+ test), src/components/EmptyState.tsx
- src/app/globals.css (one appended rule), docs/screenshots/web-shell-*.png, docs/progress/web-shell.md
