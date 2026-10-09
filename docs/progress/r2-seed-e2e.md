# r2-seed-e2e: round 2 seed data, bot sim scenarios and e2e assertions

Status: done (e2e expected to fail until the bot / grouping / detail branches merge)
Branch: r2/seed-e2e   Last commit: (see git log)

## Done
- `scripts/seed-dev.mjs`: 24 requests. asha and ben each have every inbox bucket (New = `fresh`, never seen; Act;
  Upcoming; Waiting with a custom label; Done), and asha has every raised bucket (Overdue, Active, Waiting, Recently
  done). Due dates use IST calendar days: overdue (yesterday), today (23:30 IST, never in the past), tomorrow, later
  (+4 days). Every item except `fresh` ones gets `markSeen` by its assignee.
- The delivered request ("Send me the best photos from opening night"): Ben posts a photo in the thread, then Asha (the
  requester) closes it on his behalf with a `/done` status message replying to the photo. That gives result note +
  result message (the photo), a `status` kind message, and `onBehalfOf` in the audit row. Re-running adds nothing.
- `scripts/sim-webhook.mjs` scenarios:
  - `done-in-thread`: Ben replies `/done <note>` to the deepest message in a chain 3 deep.
  - `done-with-photo`: a photo whose caption is `/done <note>`.
  - `close-on-behalf`: Ben posts a photo; Asha replies `/done <note>` to it.
  - `bare-done-assignee`: Ben replies a plain "done" to the confirmation.
- `scripts/e2e.mjs` checks:
  - the reply-to-confirmation chain is 4 `thread` messages (Thread · 4, 4 `request.thread` audit rows).
  - done-in-thread: status, result_note, a `status` message, no onBehalfOf.
  - done-with-photo: the result message is the status message, with its photo.
  - close-on-behalf: result_by = asha, the result message is Ben's photo, audit `onBehalfOf` = ben.
  - The outbox notifies @ben (DM or "@ben, …" in the group) and not @asha.
  - bare done: the request stays open, the message lands in the thread, and the bot sends "Mark #N done?" with a button.
  - The seed runs into etm_e2e after the bot steps.
  - Web: /inbox (ben) bucket headers come in order, with the seeded items in Act / Upcoming / Waiting / New.
  - Web: /raised (asha) shows its 5 tiles in order, then its 4 sections, and the Overdue tile filters the list.
  - Web: the Delivered card sits above the original message, with the note, an image and an "on behalf of @ben" line, on
    both the sim request and the seeded one.
  - Web: the status system line "ben marked this done" appears and the thread count leaves it out.
  - Web: the Done control tolerates an optional "What was delivered?" dialog.
  - /raised expands "Recently done" when the item is hidden.
- The e2e prints `fetch` failure causes. The admin DM retries once on ECONNRESET: the scenarios now run past the
  server's keep-alive timeout, and the idle socket was reset.

## Tests
- tests/sim-webhook.test.ts: +1 test (the shape of the 4 new chains: reply targets, `/done` caption with photo,
  bare "done" without entities). I wrote it first and it failed with "SCENARIOS[name] is not a function".
- `pnpm test`: 27 files, 297 tests, ~9s. `pnpm typecheck` is clean.
- Seed: ran twice on a fresh local db (etm_seed_r2). The second run is a no-op; buckets and the deliverable were checked in SQL.
- `pnpm e2e` on this base: everything up to the bot steps passes. It then fails at
  "db: thread-chain = 4 thread replies" (the bot still makes the first reply an `append`). That is expected.
- I also ran a throwaway soft-fail copy, so every later step ran once:
  - The only failures were features from other branches, plus the cascades they cause.
  - The seed step passed inside the e2e.

## Open issues
- **Pre-existing, not mine:** `web: /admin/activity shows each step` ("comment missing from activity") also fails
  with the unmodified e7763cb e2e.
- The web assertions read `main` innerText, not markup, so they don't depend on component structure. They assume:
  - Header/tile lines read "Title", "Title 3", "Title · 3" or "3 Title".
  - Group headers are buttons named after the bucket.
  - The card has the text "Delivered".
  - The system line contains "marked this done" and "on behalf of @ben".
  - Adjust these strings if the UI branches choose other wording.
- The done-with-photo check expects the result message to be the `status` message itself, as setStatus does when the
  command has attachments.
- Additive change outside the owned scripts: one test in tests/sim-webhook.test.ts.

## Files owned
- scripts/seed-dev.mjs, scripts/sim-webhook.mjs, scripts/e2e.mjs, tests/sim-webhook.test.ts (+1 test),
  docs/progress/r2-seed-e2e.md
