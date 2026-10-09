# r2-web-inbox-raised: /inbox and /raised on groupInbox / groupRaised

Status: done (grouping itself lands in a parallel task; these pages code to the contract types)
Branch: r2/web-inbox-raised (from e7763cb)

## Done
- `/inbox` (To me): loads `listInbox(status "all", closedSince now-14d, limit 500)` and renders `groupInbox` buckets.
  `/raised` (I asked): same with `listRaised` + `groupRaised`.
- Grouping runs in `RowList` (client) on the optimistic rows, with the server's `now` passed as ISO so server and
  client bucket the same way. Ticking "Mark done" moves the row to Done at once; toast with Undo kept.
  `RowList` without `view` is still the plain list `/with/[username]` uses.
- `Group` (client): header button = caret + title + count chip, collapsible (`collapsedByDefault` from grouping),
  5 rows then "Show N more" (+5). Empty buckets are not in `groups`, so they render nothing.
- All open buckets empty -> "You're all caught up" card (`inbox/CaughtUp.tsx`) teaching `/request @name …`, `/mine`,
  `/raised`, `/done 12`; the collapsed Done group still shows under it.
- `RequestRow`: two lines. Line 2 stays on one line (chat name shrinks first, then the result snippet) and skips
  what the header says: no "Open" pill ever, no Waiting/Done pill in those buckets (custom label always shows), no
  due in Waiting/Done. Relative due via `relativeDue` (IST days): "2 days overdue", "Overdue", "Due today",
  "Due tomorrow", "Due in 3 days", "Due 21 Oct". Priority badge only when not normal. Chat name last and dimmest.
  3px left border: urgent red, high amber, normal faint blue, low none. Done rows: "✅ <resultNote>" (or "✅ Done",
  "✖️ Declined") + 📎 count.
- `/raised`: `StatTiles` (5 links, `?tile=key`, tap again clears; only Overdue red, and only when > 0). A tile
  filters rows with `tileMatches` and opens every group; empty filter says so. `PeopleStrip`: overdue/waiting people
  first, on-track ones behind "Show N more (on track)" (`<details>`), each linking to `/with/<username>`.
- `AutoRefresh`: `router.refresh()` every 30s while the tab is visible, and on becoming visible again.
- Open/Done/All chips removed from /inbox and /raised (buckets replace them); `StatusChips` stays for `/with`.
- **Outside my files (additive, one line):** `src/app/(app)/r/[id]/page.tsx` calls `requests.markSeen` when the
  viewer is the assignee and `assigneeSeenAt` is null. Checked in the browser: two views of #3 -> one
  `request.seen` audit row.

## Tests
- `src/components/request/RequestRow.test.ts` (relativeDue) and `StatTiles.test.ts` (tileMatches, parseTile):
  written first, red, then green.
- `pnpm test`: 29 files, 299 tests. `tsc` clean. Lint: 0 errors (the old `tokens.ts` warning).
- Screenshots (devadmin, `etm_r2_web_inbox_raised`, port 3211): `docs/screenshots/r2-web-inbox-raised-*.png`
  (inbox 390/1280 with Done expanded, raised 390/1280 with Recently done expanded, raised `?tile=overdue` 390).
  They were taken with a throwaway local groupInbox/groupRaised (not committed), since grouping.ts is still stubs
  on this branch: until the grouping task merges, /inbox and /raised throw "not implemented".

## Open issues
- `tileMatches` mirrors the tile definitions by hand (overdue = not closed and due < now, waiting included;
  done this week = status done, doneAt within 7 days). If grouping counts tiles differently, tile counts and the
  filtered list drift; better to export a predicate from grouping.ts.
- `toSections` in `src/lib/sections.ts` is now unused (only `splitWith` is). Delete when /with moves to grouping.
- /with/[username] still uses the plain list; SPEC wants each block grouped the same way (another task).
