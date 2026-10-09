# r2-web-deliverable: Delivered card, Done sheet, ⭐ deliverable, status system lines

Status: done
Branch: r2/web-deliverable (from e7763cb)

## Done
- `/r/[id]` shows a highlighted "✅ Delivered" card just under the title, above everything else, when the request is done and has a result note or result message. It shows the note, the result message's text (if it differs from the note), its photos/files (each opens the signed `/api/files` URL), "by @x · time", "Open in Telegram", and "Closed by X on behalf of @assignee" when someone other than the assignee closed it. Reopening hides it, because the service clears result_*.
- Done in the status control opens a sheet, "What was delivered? (optional)". It has a note field and a "Use a message from the thread" radio list (None + every original/append/thread message, with 📎 counts). It starts on the current result message. Mark done calls `setStatus` with `note` (which becomes the status note and the result note) and `result.messageId`. Leaving both empty gives a plain done.
- "⭐ Mark as deliverable" appears on every original/append/thread message for the assignee, requester and admins (`canManage`). It calls `markDeliverable`. The current deliverable shows "⭐ Deliverable" instead.
- Kind 'status' messages render as centered system lines, worded from the matching `request.status` audit row (`data.messageId`), e.g. "✅ @dev marked this done on behalf of @asha: “…”". If no row matches, the line is "@x: <command text>". The thread count includes kind 'thread' only.
- Activity timeline: "set status to Done on behalf of @asha", "marked a message as the deliverable", "opened it" (request.seen).
- New actions: `doneAction(id, {note, messageId})` and `markDeliverableAction(id, messageRowId)`.

## Tests
- `Thread.test.ts` has 4 new `statusLine` tests. `Delivered.test.ts` has 3 `deliveredInfo` tests. All were written first and failed before the code.
- `pnpm test`: 28 files, 299 tests. tsc is clean. lint: 0 errors (1 old warning).
- Screenshots: `docs/screenshots/r2-web-deliverable-*.png`. I took them on etm_r2_web_deliverable, logged in as @dev, using the seed plus a local-only extra seed: on #11, asha's photo reply was marked as the result and @dev (the requester) closed it on behalf of @asha, and #13 got a `/waiting` status line.
  - `delivered-390/1280`: #11, with the card, the ⭐ Deliverable tag and the on-behalf system line
  - `thread-status-390`: #13, a waiting status line
  - `done-sheet-390`: the sheet with a note and a picked message
  - `after-done-390/1280`: #13 after Mark done

## Open
- `Timeline.tsx` is outside my files. I made a small additive change there: an optional `assignee` prop and two new action cases.
- `markSeen` is not called from `/r/[id]` yet. That belongs to whichever task owns "New"/seen. It is a one-line call in page.tsx.
- If you ⭐ a message while the request is open, then press Done and pick "None", the result is cleared. The sheet preselects the ⭐ message, so you only lose it if you pick None on purpose.
- Seeded photos use fake Telegram file ids, so the images show as alt text on empty boxes in dev.
