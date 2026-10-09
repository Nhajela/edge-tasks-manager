# r2-tutorial: landing tutorial merged, synced with the round 2 SPEC, single source for /help and README

Status: done
Branch: r2/tutorial (from e7763cb, merged task/landing-tutorial)

## Done
- Merged `task/landing-tutorial` (clean merge). Landing keeps the hero + LoginButton; the tutorial (steps +
  searchable dictionary) sits below.
- `src/components/landing/tutorial-content.ts` synced with the SPEC as of round 2:
  - Thread rule: plain replies to the bot's confirmation are thread messages; only `/append` changes the request
    (the old "plain replies to #12 are added" copy is gone).
  - Status from anywhere in the thread: `/doing`, `/waiting`, `/done`, `/decline`, `/reopen` as a reply to any
    message of the request, `@bot done` / `@bot on it`, the plain "done"/"✅" one-tap button, the status line.
  - Close on behalf (requester/admin; the assignee is told), the deliverable (`/done` with or replying to a
    photo/file), the ✅ Delivered card, `/reopen` clears it, ⭐ Mark as deliverable on the web.
  - Verb buckets: To me (New, Act, Upcoming, Waiting, Done) and I asked (tiles, sections, People strip).
  - 10 steps now; the step count in the header is derived (`STEPS.length`), "in 60 seconds" dropped.
- Single source: `Entry.help` (short line) feeds `helpLines(bot)` -> bot `/help` (`src/lib/bot/replies.ts` HELP,
  also used by the /start welcome). `commandsMarkdown(bot)` -> README "Bot commands" table between
  `<!-- commands:start/end -->`, written by `node scripts/readme-commands.mjs` (Node 24 loads the .ts directly).
  A test fails when the README drifts from the data.
- Commands typed by other people in the chat mocks are monospace too (was "you" only).
- Screenshots: `docs/screenshots/r2-tutorial-landing-{390,1280}.png`, `r2-tutorial-search-{390,1280}.png`
  (search "behalf"). No horizontal scroll at 390.

## Tests
- `src/components/landing/tutorial-content.test.ts`: +2 (help lines cover every entry with `help`; README table
  equals the generated one). The README test was written first and failed.
- `pnpm test`: 28 files, 296 tests passed. tsc clean.

## Open issues
- `src/lib/bot/replies.ts` now imports from `src/components/landing/tutorial-content.ts` (lib -> components). The
  file has no imports so it is safe; move it to `src/lib/` if that layering bothers anyone.
- Copy describes SPEC behaviour that other round 2 tasks are still building (Delivered card, status line, verb
  buckets, ⭐ Mark as deliverable, the plain "done" button). Re-check wording once those land.
- README bot name is fixed as `@EdgeTasksBot` in the generated table (as before); /help uses TELEGRAM_BOT_USERNAME.
- Landing is logged-out only, so no dev-login was needed for the screenshots.
