# mcp-oauth: OAuth for /api/mcp (CIMD + DCR, PKCE), so claude.ai and other connectors can sign in

Status: done
Branch: claude/mcp-oauth

## Done
- Discovery: `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` (rewritten to
  `/api/oauth-*` in next.config), built from the request's origin. The `/api/mcp` 401 now carries
  `WWW-Authenticate: Bearer resource_metadata=…` (plus `error="invalid_token"` when a token was sent).
- Clients: a client ID metadata document (https `client_id`, MCP 2026-07-28 default) or dynamic client registration at
  `POST /oauth/register` (a sealed `client_id`, nothing stored). Ported from eci-events-mcp `src/lib/oauth/clients.ts`.
- `GET /oauth/authorize` checks client, redirect URI, PKCE S256 and `resource`, then sends the browser to `/connect`.
  `/connect` asks the person to log in with Telegram if needed (the existing LoginButton; the page re-renders once
  logged in), names the app and where it returns, and offers Allow / Don't allow.
- Allow posts to `POST /oauth/authorize`: it mints an ordinary `etm_` token through `tokens.create` (named
  "<app> (connected)", audited `token.create`) and 303s back with a 60-second sealed code. Same-site only: SameSite=Lax
  cookie plus an Origin check.
- `POST /oauth/token` (authorization_code only) checks client, redirect URI, PKCE and resource, and returns that `etm_`
  token. No expiry and no refresh token: revoking it on `/settings` disconnects the app, which gets a 401 and signs in
  again.
- Sealing: AES-256-GCM under `OAUTH_SECRET` (falls back to `SESSION_SECRET`), `src/lib/oauth/seal.ts`. No new
  dependencies, no schema change.
- `/settings` shows the connector URL for apps that sign in; README explains the flow.

## Tests
- `src/lib/oauth/oauth.test.ts` (unit): seal round-trip, expiry, tampering; PKCE; DCR register/resolve, loopback port
  change, refused schemes, CIMD private hosts; metadata; authorize errors (in-page vs redirected, with state and iss);
  token exchange refusals.
- `tests/db/oauth.test.ts` (DB, through the real routes): discovery + 401 header; register → authorize → Allow →
  token → whoami as that person, token listed and audited, revoke → 401 invalid_token; Don't allow; cross-site and
  logged-out consent posts refused; wrong PKCE verifier refused.
- `pnpm test`: 41 files, 422 tests. `pnpm typecheck` and `pnpm lint` clean.
- Browser e2e on `pnpm dev`: logged-out /connect, Telegram dev login, consent, Allow → callback with code, state and
  iss → token → whoami → row on /settings. It caught one bug, fixed before commit: `Referrer-Policy: no-referrer` on
  /connect made Chrome send `Origin: null` on the Allow post, so it is `same-origin`.

## Open issues
- Each connect makes a new token row; reconnecting the same app leaves the old one until revoked (DCR client ids
  differ per registration, so there is no stable key to replace it by).
- Rotating `OAUTH_SECRET`/`SESSION_SECRET` invalidates DCR client ids; the app must register again.
- `scripts/seed-dev.mjs` fails with `createDb is not a function` (pre-existing, not touched here).
