# Progress ledger

Each task writes **one file**, `docs/progress/<key>.md` (key = the task's short name, e.g. `bot-parse`, `inbox`),
and keeps it current as it works. Only touch your own file. Format:

```md
# <key>: <one-line scope>

Status: not started | in progress | blocked | done
Branch: <branch>   Last commit: <sha>

## Done
- what works now, user-visible first (one line each)

## Tests
- files added/changed and what they cover; result of `pnpm test` (count, time)

## Open issues
- bugs, shortcuts (`ponytail:` notes), questions for the owner, contract changes other tasks must know about

## Files owned
- paths this task created or changed
```

Rules: shared contracts (`src/services/*`, `src/lib/bot/types.ts`, `src/db/schema.ts`, `src/components/request/*`,
`src/lib/format.ts`) are frozen. If you need a change there, say so under **Open issues** instead of editing them.
