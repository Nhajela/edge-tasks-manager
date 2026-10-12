import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sameResource, startAuthorize } from "./authorize";
import { redirectAllowed, registerClient, resolveClient } from "./clients";
import { authServerMetadata, protectedResourceMetadata, requestOrigin, wwwAuthenticate } from "./metadata";
import { verifyPkce } from "./pkce";
import { seal, unseal } from "./seal";
import { exchangeToken } from "./token";

const ORIGIN = "https://tasks.example.org";
const VERIFIER = "v".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

beforeAll(() => {
  process.env.SESSION_SECRET ||= "unit-test-secret";
});

async function dcr(redirect = "https://claude.ai/api/mcp/auth_callback") {
  const r = await registerClient({ client_name: "Claude", redirect_uris: [redirect] });
  if (!r.ok) throw new Error("register failed");
  return r.body.client_id as string;
}

const authorizeParams = (clientId: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "s1",
    resource: `${ORIGIN}/api/mcp`,
    ...extra,
  });

describe("seal", () => {
  it("round-trips, and refuses another type, an expired token or a tampered one", () => {
    const t = seal("code", { a: 1 }, 60);
    expect(unseal<{ a: number }>("code", t)?.a).toBe(1);
    expect(unseal("authreq", t)).toBeNull();
    expect(unseal("code", t, Date.now() + 61_000)).toBeNull();
    const flipped = Buffer.from(t, "base64url");
    flipped[20] ^= 1;
    expect(unseal("code", flipped.toString("base64url"))).toBeNull();
    expect(unseal("code", "junk")).toBeNull();
  });

  it("needs a ttl for everything but a client id", () => {
    expect(() => seal("code", {}, null)).toThrow();
    expect(unseal("client", seal("client", { n: 1 }, null))).toMatchObject({ n: 1 });
  });
});

describe("pkce", () => {
  it("accepts the matching verifier only", () => {
    expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true);
    expect(verifyPkce("w".repeat(43), CHALLENGE)).toBe(false);
    expect(verifyPkce("short", CHALLENGE)).toBe(false);
  });
});

describe("clients", () => {
  it("registers a DCR client without storage and resolves it back", async () => {
    const id = await dcr();
    const c = await resolveClient(id);
    expect(c).toMatchObject({ kind: "dcr", name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] });
    expect(redirectAllowed(c!, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectAllowed(c!, "https://evil.example/cb")).toBe(false);
  });

  it("lets a loopback redirect change port (native apps like Claude Code)", async () => {
    const c = await resolveClient(await dcr("http://localhost:33418/callback"));
    expect(redirectAllowed(c!, "http://localhost:51000/callback")).toBe(true);
  });

  it("refuses script schemes and empty redirect lists", async () => {
    expect((await registerClient({ redirect_uris: ["javascript:alert(1)"] })).ok).toBe(false);
    expect((await registerClient({ redirect_uris: [] })).ok).toBe(false);
  });

  it("won't fetch a CIMD document from a private address", async () => {
    expect(await resolveClient("https://127.0.0.1/client.json")).toBeNull();
    expect(await resolveClient("https://10.0.0.2/client.json")).toBeNull();
  });
});

describe("metadata", () => {
  it("names this origin's MCP endpoint and its authorization server", () => {
    expect(protectedResourceMetadata(ORIGIN)).toMatchObject({ resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN] });
    expect(authServerMetadata(ORIGIN)).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ["S256"],
    });
    expect(wwwAuthenticate(ORIGIN, true)).toBe(`Bearer error="invalid_token", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
  });

  it("takes the origin from forwarding headers when present", () => {
    expect(requestOrigin(new Request("http://localhost:3000/x"))).toBe("http://localhost:3000");
    const fwd = new Request("http://internal/x", { headers: { "x-forwarded-host": "tasks.example.org", "x-forwarded-proto": "https" } });
    expect(requestOrigin(fwd)).toBe(ORIGIN);
  });

  it("matches the resource with or without a trailing slash", () => {
    expect(sameResource(`${ORIGIN}/api/mcp/`, ORIGIN)).toBe(true);
    expect(sameResource("https://other.example/api/mcp", ORIGIN)).toBe(false);
  });
});

describe("startAuthorize", () => {
  it("sends a good request to /connect with a sealed copy of it", async () => {
    const r = await startAuthorize(authorizeParams(await dcr()), ORIGIN);
    expect(r.kind).toBe("redirect");
    if (r.kind !== "redirect") return;
    expect(r.location).toMatch(/^\/connect\?req=/);
  });

  it("answers in the page, never by redirect, for an unknown client or an unregistered redirect", async () => {
    expect(await startAuthorize(authorizeParams("nope"), ORIGIN)).toMatchObject({ kind: "error", status: 400 });
    const r = await startAuthorize(authorizeParams(await dcr(), { redirect_uri: "https://evil.example/cb" }), ORIGIN);
    expect(r).toMatchObject({ kind: "error", status: 400 });
  });

  it("sends protocol errors back to the client with state and iss", async () => {
    const id = await dcr();
    for (const [extra, error] of [
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ resource: "https://other.example/api/mcp" }, "invalid_target"],
    ] as const) {
      const r = await startAuthorize(authorizeParams(id, extra), ORIGIN);
      if (r.kind !== "redirect") throw new Error("expected a redirect");
      const u = new URL(r.location);
      expect(u.searchParams.get("error")).toBe(error);
      expect(u.searchParams.get("state")).toBe("s1");
      expect(u.searchParams.get("iss")).toBe(ORIGIN);
    }
  });
});

describe("exchangeToken", () => {
  const code = (over: Record<string, unknown> = {}) =>
    seal(
      "code",
      { token: "etm_x", clientId: "c1", redirectUri: "https://claude.ai/cb", codeChallenge: CHALLENGE, resource: null, ...over },
      60,
    );
  const body = (over: Record<string, string> = {}) =>
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "c1",
      code: code(),
      redirect_uri: "https://claude.ai/cb",
      code_verifier: VERIFIER,
      ...over,
    });

  it("returns the etm_ token for a good code", async () => {
    expect(await exchangeToken(body(), ORIGIN)).toEqual({ status: 200, body: { access_token: "etm_x", token_type: "Bearer" } });
  });

  it.each([
    [{ client_id: "c2" }, "invalid_grant"],
    [{ redirect_uri: "https://claude.ai/other" }, "invalid_grant"],
    [{ code_verifier: "w".repeat(43) }, "invalid_grant"],
    [{ code: "junk" }, "invalid_grant"],
    [{ resource: "https://other.example/api/mcp" }, "invalid_target"],
    [{ grant_type: "refresh_token" }, "unsupported_grant_type"],
  ])("refuses %j with %s", async (over, error) => {
    const r = await exchangeToken(body(over), ORIGIN);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(error);
  });
});
