# r2-web-with-admin: /with/[username] and /admin grouped (SPEC "Grouping (never mix directions)")

Status: done
Branch: r2/web-with-admin (from e7763cb)

## Done
- `/with/[username]`: two blocks, "@bob asked you" then "You asked @bob", each with a count. Empty blocks are hidden. Each block is split into buckets: `groupInbox` for "asked you" and `groupRaised` for "you asked". Data comes from `listBetween` with `status: "all"` and `closedSince` set to 14 days ago. Rows go through `RowList`, so "Mark done" with Undo still works on my side. The Open/Done/All chips are gone, because the Done bucket replaces them.
- `/admin`: grouped by assignee (`admin/byAssignee.ts`, pure). People with overdue items come first, then those with the most open items, then by name. Each person header shows a count chip, plus "N open" when the status filter includes closed rows, plus "N overdue" in red. Rows inside a group are sorted open first, then by priority (urgent first), then due date ascending (undated last), then oldest first. Rows say "from @requester", since the header already names the assignee. Rows hide the due label once a request is closed. The filters (person, chat, status chips) and paging are unchanged.
- Screenshots: `docs/screenshots/r2-web-with-admin-{with-ben,with-chitra,admin,admin-all}-{390,1280}.png`. No horizontal scroll at 390.

## Tests
- `src/app/(app)/admin/byAssignee.test.ts`: 2 unit tests, written first and seen failing (module missing). They cover group order with open/overdue counts (a closed row counts as neither) and the row sort.
- `pnpm test`: 28 files, 294 tests pass. tsc is clean. Lint shows 0 errors (the 1 old warning).

## Open (for the integrator)
- **Local Group component:** `src/app/(app)/with/Group.tsx` stands in for `src/components/request/Group.tsx`, which was not on this base. It is a native `<details>` with a caret, title, count chip and optional `meta`, and it has no "Show N more". Once r2/web-inbox-raised lands, switch both pages to the shared component and delete this file. `/admin` imports it from `../with/Group`.
- **Grouping fallback:** `grouping.ts` is still a stub on this base. Until it is implemented, `/with` catches only the "not implemented" error and falls back to the old `toSections` status sections (Needs you / Not started / ...), and the screenshots show that fallback. Delete `bucket()`'s catch once r2/grouping merges.
- `/with` drops the "/raised" tiles and people strip; for a single person they add nothing.
- Done requests older than 14 days no longer appear on `/with`.
- `/admin` groups only the current page of 100 rows, so a person's group can be split across pages, and the counts cover that page only.
- `RequestRow` still says "from @bob" inside the "@bob asked you" block, which is redundant. That component is not owned by this task.

## Files owned
- `src/app/(app)/with/[username]/page.tsx`, `src/app/(app)/with/Group.tsx` (new)
- `src/app/(app)/admin/page.tsx`, `src/app/(app)/admin/byAssignee{,.test}.ts` (new)
- `docs/screenshots/r2-web-with-admin-*.png`, `docs/progress/r2-web-with-admin.md`
