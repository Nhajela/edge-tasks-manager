# ai-titler: OpenRouter titler (title, priority, due, question) behind `titleRequest`

Status: done
Branch: task/ai-titler   Last commit: see `git log task/ai-titler`

## Done
- `titleRequest(db, requestId, deps?)` (signature unchanged) calls OpenRouter and writes title / priority / due as
  `aiActor()` through `requests.setTitle/setPriority/setDue`. Fields a human has locked are skipped by the service.
  Fields whose value is unchanged are not written, so the timeline gets no empty AI rows. A null due from the model
  never clears a due date that is already set.
- No key (`OPENROUTER_API_KEY` unset, or `apiKey: null`): ai_status becomes `skipped` and no call is made. Any
  error (HTTP, timeout, bad JSON, zod rejection): ai_status becomes `failed` and the heuristic title stays.
- The question goes to `aiContext.addQuestion` (status open, request_id) and to `requests.ai_question`, then
  ai_status becomes `done`.
- When the title changed and the request has a bot confirmation, the bot message is edited with
  `tg("editMessageText")`. The edit re-sends the "Open the dashboard" button, because editMessageText without
  reply_markup drops the keyboard.
- `src/lib/ai/context.ts`: Edge City India context (dates, Riva Beach Resort Mandrem, common needs), the
  ai_context facts and answered Q&A, today in IST, a 24-day calendar ("Fri 16 Oct = 2026-10-16"), the due
  conventions (tonight = 21:00, morning = 10:00, DD/MM, "before the opening" = 11 Oct 09:00), and the priority rubric.
- `src/lib/ai/titler.ts`: OpenRouter request with `response_format: json_schema` (strict). On HTTP 400 it retries
  once with `json_object`. Each call has a 20s `AbortSignal.timeout`. Output is validated with zod (title trimmed
  to 60 characters, code fences tolerated). `istToDate` converts IST wall time to a Date; a date with no time
  means 18:00 IST.
- Model: `OPENROUTER_MODEL`, default `google/gemini-2.5-flash`. OpenRouter's public `/api/v1/models` list
  shows this id as live with structured outputs, so the default stays.

## Tests
- `src/lib/ai/titler.test.ts` (unit): prompt contents (context, IST today, calendar, rules, memory, request);
  IST due conversion for "tonight", "tomorrow morning", "by Friday", "before the opening on the 11th" and
  "14/10"; the OpenRouter request shape (url, key, model, json_schema, timeout signal); fallback to json_object;
  fence and trim handling; failure on invalid output or HTTP 500.
- `src/services/__tests__/titler.test.ts` (db): the skipped path; the full write (title, priority, due,
  question in ai_context and on the request, confirmation edit with the button); human locks respected with no
  edit when the title is unchanged; failure sets `failed` and keeps the title.
- `pnpm test`: 60/60 passed in about 7.6–9.3s (vitest Duration), tested over 5 runs. In 2 of those runs, other
  db test files failed with `3D000 database does not exist`. See the open issues.

## Open issues
- Additive contract change: `TitlerDeps.tg?` (optional, for tests). Also new: `confirmationMessage(request,
  assignee)` exported from `src/services/titler.ts`. **The bot handler should send its "#12 created" reply with
  this same helper** so the AI edit keeps the same text and button. If it doesn't, the edit changes the wording.
- The model works out the dates from the calendar and rules in the prompt. The code only converts IST wall time.
  The model's phrase reading is not unit-tested, because tests mock fetch.
- No live OpenRouter call was made, because the owner's relayed message ("I think not") was ambiguous. The model
  id was checked on the free public models list instead. To smoke-test: `titleRequest` on a dev DB with the key set.
- Test infra: every worktree shares the Postgres on :5545 and the per-worker database names `etm_test_<POOL_ID>`.
  Parallel agents drop each other's databases, which causes the occasional 3D000 failures. Each checkout needs
  its own name prefix (for example a hash of the cwd) in tests/global-setup.ts and tests/setup-db.ts. That is not
  this task's file.
- The edit fires only when the title changed. A change to priority or due alone does not touch the bot message,
  because the message doesn't show them.

## Files owned
- src/services/titler.ts, src/services/__tests__/titler.test.ts
- src/lib/ai/context.ts, src/lib/ai/titler.ts, src/lib/ai/titler.test.ts
- docs/progress/ai-titler.md
