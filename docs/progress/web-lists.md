# web-lists: /inbox, /raised, /with/[username] list pages with quick Mark done

Status: done
Branch: task/web-lists   Last commit: see `git log -1 task/web-lists`

## Done
- `/inbox` (To me) and `/raised` (I asked): tab switcher with open counts for both lists, Open / Done / All chips
  (`?status=done|all`, open by default) with counts, empty states that say what to do next.
- `/with/[username]`: "You and @bob", every request either of you asked the other, same chips; unknown username -> 404.
- Rows (`RequestRow`): priority dot, title (whole row opens `/r/<id>`), "from @x" / "to @x" (the other person, links
  to `/with/x`), status pill or custom label, due / overdue (open rows only), `#id · age`, attachment and thread
  reply counts. Done rows are struck through and muted.
- Mark done checkbox on every row assigned to me (inbox, and my side of `/with`): optimistic (`useOptimistic`, the
  row leaves the Open list at once), server action `inbox/actions.ts#setRowStatus` -> `requests.setStatus` ->
  `after(runEffects)` + `refresh()`; toast "#12 marked done" with Undo (puts back the previous status + custom
  label). Unticking a done row reopens it. Errors show a toast and the row snaps back.
- Screenshots (390 and 1280): `docs/screenshots/web-lists-*.png`.

## Tests
- `src/services/__tests__/requests.lists.test.ts`: list rows carry `threadCount` (thread replies only; the original
  and appends don't count). Seen red before the service change, green after.
- UI checked by hand in Playwright on `etm_web_lists` (port 3202): mark done hides the row, counts update after the
  refresh, Undo restores it; each change wrote one `request.status` audit row.
- `pnpm test`: 10 files, 44 tests passed, 8.3s. `tsc` clean; lint shows only the old `tokens.ts` warning.

## Open issues
- **Shared change (additive):** `ListItem` gained `threadCount: number` (subquery on `request_messages.kind =
  'thread'`) in `src/services/requests.ts#list`. Integrator: keep it when merging.
- Undo is a second `setStatus`, so it writes a second audit row and, if the requester gets notifications, they get
  "done" then "open". A deferred commit would avoid that but can lose the change if the tab closes.
- Lists show the first 100 rows (service default); no pagination yet.
- The header nav in `Shell` doesn't highlight the current page (layout passes no `current`); not in this task's files.

## Files owned
- `src/app/(app)/inbox/{page.tsx,RowList.tsx,actions.ts}`, `src/app/(app)/raised/page.tsx`,
  `src/app/(app)/with/[username]/page.tsx`, `src/components/request/{RequestRow,ListFilters}.tsx`,
  `src/services/__tests__/requests.lists.test.ts`, `src/services/requests.ts` (threadCount only),
  `docs/screenshots/web-lists-*.png`, `docs/progress/web-lists.md`
