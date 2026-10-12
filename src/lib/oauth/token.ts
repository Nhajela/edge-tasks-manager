import { type CodePayload, MCP_PATH } from "./authorize";
import { verifyPkce } from "./pkce";
import { unseal } from "./seal";

type TokenResult = { status: number; body: Record<string, unknown> };

const err = (error: string, description: string, status = 400): TokenResult => ({ status, body: { error, error_description: description } });

export async function parseTokenBody(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const j: unknown = await request.json().catch(() => null);
    if (j === null || typeof j !== "object" || Array.isArray(j)) return new URLSearchParams();
    return new URLSearchParams(Object.entries(j as Record<string, unknown>).filter(([, v]) => typeof v === "string") as [string, string][]);
  }
  return new URLSearchParams(await request.text());
}

/**
 * POST /oauth/token. The access token is the etm_ token minted at Allow: it has no expiry and no refresh token, and it
 * stops working when the person revokes it in Settings (the client then gets a 401 and signs in again).
 * A replayed code returns the same token, and only to whoever holds the PKCE verifier, so codes need no used-list.
 */
export async function exchangeToken(p: URLSearchParams, origin: string): Promise<TokenResult> {
  const grant = p.get("grant_type");
  if (!grant) return err("invalid_request", "grant_type is required.");
  if (grant !== "authorization_code") return err("unsupported_grant_type", "Use authorization_code.");
  const clientId = p.get("client_id");
  if (!clientId) return err("invalid_request", "client_id is required.");
  const code = unseal<CodePayload>("code", p.get("code") ?? "");
  if (!code) return err("invalid_grant", "The code is invalid or expired.");
  if (clientId !== code.clientId) return err("invalid_grant", "Code was issued to another client.");
  if (p.get("redirect_uri") !== code.redirectUri) return err("invalid_grant", "redirect_uri does not match.");
  if (!verifyPkce(p.get("code_verifier") ?? "", code.codeChallenge)) return err("invalid_grant", "PKCE verification failed.");
  const resource = p.get("resource");
  if (resource && resource.replace(/\/+$/, "") !== (code.resource ?? `${origin}${MCP_PATH}`).replace(/\/+$/, ""))
    return err("invalid_target", "Unknown resource.");
  return { status: 200, body: { access_token: code.token, token_type: "Bearer" } };
}
