# mcp-settings-ui: API tokens + MCP setup snippets on /settings

Status: done
Branch: task/mcp-settings-ui   Last commit: see `git log -1 task/mcp-settings-ui`

## Done
- /settings "AI assistant access (MCP)" card: name a token, create it, and see the raw `etm_` token once with a copy button ("I saved it" hides it).
- Token list shows the name, prefix (`etm_xxxx…`), "used 3h ago" or "never used", and the date it was made. Revoke asks for confirmation in a dialog.
- Paste-ready blocks, each with Copy: the `claude mcp add --transport http edge-tasks <origin>/api/mcp --header "Authorization: Bearer …"` command, JSON `mcpServers` config, and a curl `tools/list` check. They fill in the fresh token right after you create it, otherwise they show `etm_…` with a "replace this" hint.
- Server actions in `src/app/(app)/settings/mcp-actions.ts` (list/create/revoke) are thin: viewer -> Actor -> `services/tokens` -> `{ok, …}`. ServiceErrors become `{ok:false, error}`. Audit rows come from the service (token.create / token.revoke).
- Screenshots: docs/screenshots/mcp-settings-ui-{390-empty,390,1280,390-revoke}.png (local DB etm_mcp_settings_ui, port 3207, logged in as asha). The Playwright run went through create, copy-once, revoke-confirm and back to the empty list.

## Tests
- src/components/settings/McpAccess.test.ts: the snippet builder (exact Claude command, JSON parses to the expected config, curl has the bearer + SSE accept + tools/list).
- `pnpm test`: 10 files, 46 tests pass in 9.7s (the new file is slow to import because it pulls the client module's server-action imports). tsc clean, eslint clean on owned files.

## Open issues
- Snippets use `window.location.origin`, not `SITE_URL`, so they are correct on prod, previews and local dev. In dev, SITE_URL fell back to localhost:3000.
- The page still shows the Placeholder "Coming soon." line above the card. page.tsx is not owned by this task, so the integrator or settings-page owner should drop Placeholder.
- Tokens load on mount through a server action (a skeleton shows briefly) because page.tsx renders `<McpAccess />` with no props. If page.tsx later passes `initialTokens`, the first fetch can go away.
- No claude.ai snippet. claude.ai custom connectors need OAuth and can't send a bearer header. SPEC mentions claude.ai.
- Copy relies on navigator.clipboard. Where that is blocked (some in-app browsers), every block is `select-all` as a fallback.
- The curl check is untested against a real /api/mcp (still a stub at c41c34b).

## Files owned
- src/components/settings/McpAccess.tsx, src/components/settings/McpAccess.test.ts
- src/app/(app)/settings/mcp-actions.ts
- docs/screenshots/mcp-settings-ui-*.png, docs/progress/mcp-settings-ui.md
