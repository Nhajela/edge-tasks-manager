# r2-grouping: pure groupInbox / groupRaised (SPEC "Grouping (never mix directions)")

Status: done
Branch: r2/grouping   Last commit: see `git log -1 r2/grouping`

## Done
- `groupInbox(items, now)`: New, Act, Upcoming, Waiting, Done in that fixed order. Empty buckets are left out and Done is collapsedByDefault.
  - New: status `open` and `assigneeSeenAt` is null. It wins over Act even when the item is overdue. An unseen in_progress or waiting item is not New, because the assignee already acted on it.
  - Act: open or in_progress with a due date on or before tomorrow in IST calendar days (overdue included), or no due date. Upcoming: the due date is after tomorrow in IST.
  - Waiting: every `waiting` item, whatever its due date.
  - Done: done or declined with `doneAt` in the last 14 days, rechecked here even though callers pass `closedSince`. A closed row with a null `doneAt` is kept.
- `groupRaised(items, now)`: Overdue, Active, Waiting, Recently done (collapsed). Overdue covers any open, in_progress or waiting item whose due time has passed, using the same instant test as `dueLabel()`, so the bucket matches the red row label.
  - Tiles: always all five, in fixed order, and only Overdue has `danger: true`. Open, In progress and Waiting are plain status counts, so they can overlap Overdue. "Done this week" counts status `done` only (not declined) with `doneAt` within today and the 6 IST days before it. It is a rolling week, not Monday-based.
  - People: assignees of non-closed items, with open, overdue and waiting counts. `onTrack` means no overdue and no waiting items. People with problems come first, ordered by more overdue, then more waiting, then more open, then name. On-track people come after them in the same order.
- Inside every bucket the order is priority (urgent first, low last), then due date ascending with undated last, then createdAt ascending, then id. The input array is not mutated. Dates may be Date objects or ISO strings.

## Tests
- `src/services/__tests__/grouping.test.ts`: 28 cases covering bucket membership, fixed order and titles, empty buckets omitted, the collapsed flags, the IST midnight rollover both ways (23:59 IST and 00:30 IST), the 14-day window, every sort key, tiles, the people strip and its ordering, and JSON round-trip dates. All 28 failed against the stubs before the code was written.
- `pnpm test`: 28 files, 320 tests, about 10s. `tsc --noEmit` is clean and eslint on both files is clean.

## Open issues
- Nothing uses these functions yet. `src/lib/sections.ts` (`toSections`, round 1) still drives `/inbox`, and the web-lists, bot and MCP tasks should switch to `groupInbox` and `groupRaised`. `toSections` can be deleted once they do.
- The file is in `src/services/__tests__`, so it runs in the "db" vitest project even though it is pure. It only pays the DB setup cost.

## Files owned
- src/services/grouping.ts
- src/services/__tests__/grouping.test.ts
- docs/progress/r2-grouping.md
