# web-detail: /r/[id] request detail page

Status: done
Branch: task/web-detail   Last commit: see `git log task/web-detail`

## Done
- `/r/[id]` shows the request to its requester, assignee, creator and admins. Anyone else, a missing id or a non-numeric id gets the normal 404, so the page doesn't reveal that the request exists.
- Status segmented control: Open · Doing · Waiting · Done · Declined. It updates optimistically and shows a toast if the save fails. Picking a different status clears the custom label, as the service rule does.
- Custom label input with `<datalist>` suggestions. Set saves it; submitting it empty clears it.
- Priority segmented control and a due-date editor. The due editor takes an IST date, saves the end of that IST day, and has a Clear button. A lock icon shows on fields a person has set.
- Editable title (pencil icon). It calls `setTitle`, which sets `title_locked`, and the form says the AI won't rename it after the edit.
- Original and appended messages as cards, each with "Open in Telegram" and photos/files. File links are relative, signed `/api/files/<id>?sig=` URLs.
- The thread is a flat, chat-style list. Each message has a "↳ replying to <name>: <snippet>" quote, and a reply to the bot's confirmation is quoted as "the bot".
- Activity timeline read from `audit_log`, in readable wording. Comments appear as bubbles.
- Comment box with a "Tell <person> on Telegram" toggle, on by default. The requester tells the assignee; everyone else tells the requester. The toggle is hidden when the viewer would be telling themselves.
- `<AiQuestionCard>` slot: it gets `aiQuestion` and `canAnswer = isAdmin`.
- Server actions are in `src/app/(app)/r/[id]/actions.ts`. Each one gets the viewer, calls the service, runs effects with `after(() => runEffects(...))`, calls `refresh()`, and returns an `ActionResult`.
- Screenshots in `docs/screenshots/web-detail-*.png`:
  - `thread-390`, `thread-1280`: the seeded reply chain on #13
  - `after-edits-390`: after changing status, label, comment, priority and due
  - `r1-390`
  - `404-390`: an outsider opening #13

## Tests
- `src/components/request/Thread.test.ts` covers `replyQuote`: the SPEC chain, the bot-confirmation quote, clipping, and non-replies.
- `pnpm test`: 10 files and 46 tests pass in 5.2s. tsc is clean, and eslint is clean on the files I own.
- Checked by hand on a fresh `etm_web_detail` database through Playwright, running as asha. Each UI action wrote exactly one audit row (status, status label, comment, priority, due). chitra got a 404 on #13.

## Open issues
- Seeded photos have fake Telegram file ids, so images couldn't be checked visually. In dev, `/api/files` returns 503 or 410 and the browser shows the alt text.
- Anyone who can view a request can edit its title, matching `permissions.canManage`. The SPEC says "editable by assignee/admin". If that is meant strictly, it needs a service change, not a UI one.
- The status label uses `<datalist>`. In some in-app browsers that is only a keyboard hint. `ponytail:` add tap chips if people don't find the suggestions.
- The dev overlay showed a hydration warning. The only differing attribute was `caret-color` on inputs, which Playwright's screenshot caret hiding injects. It is not from app code.
- The scratchpad is shared between sibling agents. Another agent ran a script named `shots.mjs` against port 3203 as devadmin while I was testing, which put duplicate rows in the audit log. The final screenshots come from a freshly reseeded database.

## Files owned
- src/app/(app)/r/[id]/page.tsx, src/app/(app)/r/[id]/actions.ts
- src/components/request/{Thread,Timeline,StatusControl,Editors,CommentBox,MessageCard}.tsx, Thread.test.ts
- docs/screenshots/web-detail-*.png, docs/progress/web-detail.md
