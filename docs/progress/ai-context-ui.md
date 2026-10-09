# ai-context-ui: /context (titler memory) admin page + AiQuestionCard for /r/[id]

Status: done
Branch: task/ai-context-ui   Last commit: see `git log -1 task/ai-context-ui`

## Done
- `/context` (admin): open AI questions, newest first, each linked to its request. Answer with "Re-title #N" (on by default) or Dismiss. Facts: add, edit, delete (Delete sits behind Edit so one stray tap can't remove a fact). Answered questions are listed with "Forget". "Re-title recent 20" runs the titler on the 20 newest requests via `after()` + `runEffects` (locked fields stay).
- Non-admins see "Only organisers can see this page."
- `AiQuestionCard({requestId, question, canAnswer})` (same props as the placeholder): shows the question. Admins answer inline ("Answer and re-title"); everyone else sees "An organiser will answer this."
- Answering or dismissing clears `requests.ai_question`, but only while it still holds that same question, so a newer question is never wiped. If the request has a question with no `ai_context` row, the answer records the question first so it still reaches the titler.
- Forms toast the result and keep the typed text when validation fails (no plain `<form action>`, which would reset the form).
- Screenshots: `docs/screenshots/ai-context-ui-{context,card-admin}-{390,1280}.png`, `-context-nonadmin-390.png`, `-context-after-390.png` (after answer/add/edit/dismiss/re-title).

## Tests
- `tests/db/context-ops.test.ts` (4 tests): answer by request id clears the card; answer by question id; record-then-answer when only the request has the question; dismiss clears only a matching question; admin only.
- Ran the full flow against the dev server (Playwright): answer on /r/15, add an empty fact (error, text kept), add, edit, dismiss, re-title 20. Audit rows came out one per service call.
- `pnpm test`: 47 passed, 10 files, 5.7s. tsc is clean. Lint shows only the existing tokens.ts warning.

## Open issues
- `/r/[id]` is still a placeholder, so it does not render the card yet. The integrator or the detail task should render `<AiQuestionCard requestId={r.id} question={r.aiQuestion} canAnswer={actor.isAdmin} />`. The screenshots used a local wiring that was not committed.
- The `/context` actions use `ops.ts`, which calls existing services only (no service or schema change). Answering makes 2 to 3 service calls (answer, plus `setAiState` to clear the card, plus `addQuestion` when the question has no row), so 2 to 3 audit rows per user action, each call writing exactly one.
- ponytail: `ops.findQuestion` uses `aiContext.list()` plus find (a full scan). Add `aiContext.getById` / a requestId filter if ai_context grows past a few hundred rows.
- "Re-title recent 20" fires up to 20 titler calls in parallel (`runEffects` uses Promise.all). Fine for OpenRouter at this scale.
- Clearing `ai_question` adds a timeline entry "AI updated" (the `request.ai` summary from `setAiState`). Better wording belongs in requests.ts (frozen).
- A dev-only hydration warning in the screenshots came from Playwright adding `caret-color` to inputs, not from app code.

## Files owned
- src/app/(app)/context/{page.tsx,actions.ts,ops.ts,ActionForm.tsx,FactRow.tsx}
- src/components/request/AiQuestionCard.tsx
- tests/db/context-ops.test.ts
- docs/screenshots/ai-context-ui-*.png, docs/progress/ai-context-ui.md
