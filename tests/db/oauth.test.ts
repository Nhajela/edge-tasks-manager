import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, makePerson } from "@tests/factories";
import * as audit from "@/services/audit";
import * as tokens from "@/services/tokens";
import type { Person, Session } from "@/lib/types";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/effects", () => ({ runEffects: vi.fn(async () => {}) }));
// the consent POST reads the browser's session cookie; tests say who is logged in
let session: Session | null = null;
vi.mock("@/lib/session", () => ({ getSession: async () => session }));

const db = testDb();
const ORIGIN = "http://tasks.test";
const MCP = `${ORIGIN}/api/mcp`;
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "x".repeat(50);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const LEGACY = "2025-11-25";

const sessionOf = (p: Person): Session => ({ telegramId: String(p.telegramId), username: p.username, firstName: p.firstName ?? "" });

async function register(): Promise<string> {
  const { POST } = await import("@/app/oauth/register/route");
  const res = await POST(new Request(`${ORIGIN}/oauth/register`, { method: "POST", body: JSON.stringify({ client_name: "Claude", redirect_uris: [CALLBACK] }) }));
  expect(res.status).toBe(201);
  return (await res.json()).client_id;
}

/** GET /oauth/authorize, then the /connect form's POST. Returns the client callback URL. */
async function authorize(clientId: string, decision: "allow" | "deny", headers: Record<string, string> = { origin: ORIGIN }) {
  const route = await import("@/app/oauth/authorize/route");
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: CALLBACK,
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "st",
    resource: MCP,
  });
  const start = await route.GET(new Request(`${ORIGIN}/oauth/authorize?${q}`));
  expect(start.status).toBe(302);
  const connect = new URL(start.headers.get("location")!);
  expect(connect.pathname).toBe("/connect");
  const form = new FormData();
  form.set("req", connect.searchParams.get("req")!);
  form.set("decision", decision);
  return route.POST(new Request(`${ORIGIN}/oauth/authorize`, { method: "POST", body: form, headers }));
}

async function exchange(clientId: string, code: string) {
  const { POST } = await import("@/app/oauth/token/route");
  const body = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: CALLBACK, code_verifier: VERIFIER, resource: MCP });
  return POST(new Request(`${ORIGIN}/oauth/token`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }));
}

async function mcp(token: string | null, method: string, params: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/mcp/route");
  return POST(
    new Request(MCP, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": LEGACY,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
}

describe("OAuth for /api/mcp", () => {
  it("publishes discovery documents for this origin, and the 401 points at them", async () => {
    const pr = await (await import("@/app/api/oauth-resource-metadata/route")).GET(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`));
    expect(await pr.json()).toMatchObject({ resource: MCP, authorization_servers: [ORIGIN] });
    const as = await (await import("@/app/api/oauth-metadata/route")).GET(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`));
    expect(await as.json()).toMatchObject({ issuer: ORIGIN, registration_endpoint: `${ORIGIN}/oauth/register` });
    const res = await mcp(null, "tools/list");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
  });

  it("register → authorize → Allow → token → whoami acts as the person who allowed", async () => {
    const me = await makePerson(db);
    session = sessionOf(me);
    const clientId = await register();
    const back = await authorize(clientId, "allow");
    expect(back.status).toBe(303);
    const cb = new URL(back.headers.get("location")!);
    expect(`${cb.origin}${cb.pathname}`).toBe(CALLBACK);
    expect(cb.searchParams.get("state")).toBe("st");
    expect(cb.searchParams.get("iss")).toBe(ORIGIN);

    const res = await exchange(clientId, cb.searchParams.get("code")!);
    expect(res.status).toBe(200);
    const { access_token, token_type } = await res.json();
    expect(token_type).toBe("Bearer");
    expect(access_token).toMatch(/^etm_/);

    const who = await mcp(access_token, "tools/call", { name: "whoami", arguments: {} });
    expect((await who.json()).result.structuredContent).toMatchObject({ id: me.id });

    // it is an ordinary token: listed in Settings by the client's name, audited, and revocable
    const [row] = await tokens.list(db, actorFor(me));
    expect(row.name).toBe("Claude (connected)");
    expect((await audit.listForEntity(db, "token", row.id)).map((a) => a.action)).toContain("token.create");
    await tokens.revoke(db, actorFor(me), row.id);
    const after = await mcp(access_token, "tools/list");
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toMatch(/error="invalid_token"/);
  });

  it("Don't allow sends access_denied and makes no token", async () => {
    const me = await makePerson(db);
    session = sessionOf(me);
    const back = await authorize(await register(), "deny");
    const cb = new URL(back.headers.get("location")!);
    expect(cb.searchParams.get("error")).toBe("access_denied");
    expect(cb.searchParams.get("code")).toBeNull();
    expect(await tokens.list(db, actorFor(me))).toEqual([]);
  });

  it("refuses the consent POST from another site or without a login", async () => {
    const me = await makePerson(db);
    session = sessionOf(me);
    const clientId = await register();
    expect((await authorize(clientId, "allow", { origin: "https://evil.example" })).status).toBe(403);
    session = null;
    expect((await authorize(clientId, "allow")).status).toBe(401);
    expect(await tokens.list(db, actorFor(me))).toEqual([]);
  });

  it("won't hand the code's token to anyone without the PKCE verifier", async () => {
    const me = await makePerson(db);
    session = sessionOf(me);
    const clientId = await register();
    const code = new URL((await authorize(clientId, "allow")).headers.get("location")!).searchParams.get("code")!;
    const { POST } = await import("@/app/oauth/token/route");
    const body = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: CALLBACK, code_verifier: "y".repeat(50) });
    const res = await POST(new Request(`${ORIGIN}/oauth/token`, { method: "POST", body }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
  });
});
