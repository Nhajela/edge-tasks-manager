# r2-bot-lists-mcp: grouped bot lists and grouped MCP list_requests; get_request returns result first

Status: done
Branch: r2/bot-lists-mcp (from e7763cb)

## Done
- Bot `/mine`, `/raised` and `/with @bob` now reply in grouped form (SPEC "Grouping"). They use `groupInbox` and
  `groupRaised` from `src/services/grouping.ts`:
  - `/mine` shows a "For you (N open)" heading. Under it come the buckets **Act**, **New**, **Upcoming** and **Waiting**,
    in that order. Each bucket has a header such as `<b>Act</b> (2)`.
  - `/raised` uses groupRaised's order, so **Overdue** comes first, then Active and then Waiting.
  - `/with @bob` replies in two blocks. "@bob asked you" is grouped like `/mine`. "You asked @bob" is grouped like
    `/raised`.
  - A reply holds at most 10 request lines in total, across all its buckets and blocks. The rest appear as "…and N more
    on the dashboard". Each line keeps the `#id title — status · due` format, with due dates in IST.
  - The bot now fetches every open item, up to 500, so that the buckets are correct. Before, it fetched only the 10
    newest.
- `replies.grouped(blocks, now, empty, max)` replaces `replies.list`.
- MCP `list_requests` returns `{ box, counts, groups: [{ key, title, count, items }] }`:
  - `box=inbox` is grouped by groupInbox and `box=raised` by groupRaised.
  - `box=all` is for admins only. It returns one group per assignee, with key `person:<id>`, title `@user` and a
    `person` field, sorted by name.
  - `limit` (default 25) now caps the items in each group, while `count` stays the full size. `offset` is removed.
  - `status=all` drops done items older than 14 days (`closedSince`).
  - Each item also carries `resultNote`.
- MCP `get_request` returns `result` as its first key: `{ note, by, at, message, attachments }`. The attachments are the
  result message's files, as signed URLs. `result` is null when there is no result.

## Tests
- `src/lib/bot/__tests__/handlers.test.ts`, "list commands":
  - Bucket order Act → New → Upcoming → Waiting, with IST due labels.
  - The 10-line cap across buckets, with the rest counted.
  - `/raised` puts Overdue first.
  - `/with` replies in two blocks, in the right order.
- `tests/db/mcp.test.ts`:
  - Grouped inbox/raised output, the status and person filters, and the per-group limit.
  - Admin per-assignee groups.
  - `get_request` returns the result first, including its message and attachment URL.
- All of these tests were written first and failed before the code was written. Full suite: 27 files, 295 tests.

## Open
- `src/services/grouping.ts` is still a stub on this branch. The bot and MCP tests mock it with
  `tests/helpers/grouping.ts`, which runs the real functions and falls back to a small stand-in only while they throw
  "not implemented". After `r2/grouping` merges, these tests run against the real code. Delete the helper and its two
  `vi.mock` lines once that works.
- Until `r2/grouping` merges, `/mine`, `/raised`, `/with` and MCP `list_requests` throw at runtime.
