import type { DbClient } from "@/db";
import { TEXT_LIMITS } from "@/services/errors";
import * as tokens from "@/services/tokens";
import type { Actor } from "@/services/types";
import { redirectAllowed, resolveClient } from "./clients";
import { seal, unseal } from "./seal";

export const MCP_PATH = "/api/mcp";
/** Time to log in through Telegram and press Allow. */
const AUTHREQ_TTL = 15 * 60;
const CODE_TTL = 60;

export type AuthRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  resource: string | null;
};

export type CodePayload = { token: string; clientId: string; redirectUri: string; codeChallenge: string; resource: string | null };

type StartResult = { kind: "redirect"; location: string } | { kind: "error"; status: number; message: string };

/** The resource must name this server's MCP endpoint (RFC 8707), so a token can't be minted for some other audience. */
export function sameResource(resource: string, origin: string): boolean {
  return resource.replace(/\/+$/, "") === `${origin}${MCP_PATH}`;
}

function backToClient(redirectUri: string, origin: string, params: Record<string, string | null>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  u.searchParams.set("iss", origin);
  return u.toString();
}

/** GET /oauth/authorize: check the request, then send the browser to /connect to log in and decide. */
export async function startAuthorize(p: URLSearchParams, origin: string): Promise<StartResult> {
  const clientId = p.get("client_id");
  const redirectUri = p.get("redirect_uri");
  if (!clientId || !redirectUri) return { kind: "error", status: 400, message: "Missing client_id or redirect_uri." };
  const client = await resolveClient(clientId);
  if (!client) return { kind: "error", status: 400, message: "Unknown client. Remove the connector and add it again." };
  // never redirect to an address the client didn't register: that would hand a code to whoever wrote the link
  if (!redirectAllowed(client, redirectUri))
    return { kind: "error", status: 400, message: "This redirect address isn't registered for the client." };

  const state = p.get("state");
  if (state !== null && state.length > 500)
    return { kind: "redirect", location: backToClient(redirectUri, origin, { error: "invalid_request", error_description: "state is too long." }) };
  const fail = (error: string, description: string): StartResult => ({
    kind: "redirect",
    location: backToClient(redirectUri, origin, { error, error_description: description, state }),
  });
  if (p.get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const challenge = p.get("code_challenge");
  if (!challenge || p.get("code_challenge_method") !== "S256") return fail("invalid_request", "PKCE with S256 is required.");
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return fail("invalid_request", "code_challenge must be a 43 character S256 value.");
  const resource = p.get("resource");
  if (resource && !sameResource(resource, origin)) return fail("invalid_target", "Unknown resource.");

  const req = seal(
    "authreq",
    { clientId, clientName: client.name, redirectUri, codeChallenge: challenge, state, resource } satisfies AuthRequest,
    AUTHREQ_TTL,
  );
  return { kind: "redirect", location: `/connect?req=${encodeURIComponent(req)}` };
}

export function readAuthRequest(req: string): AuthRequest | null {
  return unseal<AuthRequest>("authreq", req);
}

/** The token row's name in Settings, so the person can tell connections apart and revoke one. */
export const connectionName = (clientName: string) => `${clientName} (connected)`.slice(0, TEXT_LIMITS.name);

/**
 * POST /oauth/authorize from the logged-in person's /connect page. Allow mints an etm_ token for them (the same kind
 * Settings makes, so it is listed and revocable there) and sends a one-minute code back to the client; Deny sends
 * access_denied. Null means the request expired.
 */
export async function decide(db: DbClient, actor: Actor, reqToken: string, allow: boolean, origin: string): Promise<string | null> {
  const req = readAuthRequest(reqToken);
  if (!req) return null;
  if (!allow) return backToClient(req.redirectUri, origin, { error: "access_denied", error_description: "The person said no.", state: req.state });
  const { token } = await tokens.create(db, actor, { name: connectionName(req.clientName) });
  const code = seal(
    "code",
    { token, clientId: req.clientId, redirectUri: req.redirectUri, codeChallenge: req.codeChallenge, resource: req.resource } satisfies CodePayload,
    CODE_TTL,
  );
  return backToClient(req.redirectUri, origin, { code, state: req.state });
}
