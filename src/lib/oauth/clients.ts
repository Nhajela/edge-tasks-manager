// Ported from eci-events-mcp (src/lib/oauth/clients.ts). Two ways a client identifies itself, both without storage:
// - CIMD (MCP 2026-07-28 default): client_id is an https URL to a metadata doc.
// - DCR (deprecated, kept for 2025-era clients): client_id is a sealed blob.

import { seal, unseal } from "./seal";

export type OAuthClient = {
  clientId: string;
  kind: "cimd" | "dcr";
  name: string;
  redirectUris: string[];
  applicationType: "web" | "native" | null;
};

type Rejection = { ok: false; status: 400; body: { error: string; error_description: string } };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_DOC = 65_536;
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;
const MAX_URIS = 10;
const MAX_URI_LEN = 2048;
const cimdCache = new Map<string, { client: OAuthClient; at: number }>();

export function _clearCimdCache(): void {
  cimdCache.clear();
}

function urisWellFormed(uris: unknown): uris is string[] {
  return (
    Array.isArray(uris) &&
    uris.length > 0 &&
    uris.length <= MAX_URIS &&
    uris.every((u) => typeof u === "string" && u.length <= MAX_URI_LEN)
  );
}

function isLoopback(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
}

function validRedirect(uri: string, applicationType: OAuthClient["applicationType"]): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return isLoopback(uri) && applicationType !== "web";
  // Private-use schemes for native apps (e.g. cursor://). Never script schemes.
  return (
    !["javascript:", "data:", "vbscript:", "file:"].includes(u.protocol) &&
    applicationType !== "web"
  );
}

export function redirectAllowed(client: OAuthClient, redirectUri: string): boolean {
  return client.redirectUris.some((r) => {
    if (r === redirectUri) return true;
    if (!isLoopback(r) || !isLoopback(redirectUri)) return false;
    const a = new URL(r);
    const b = new URL(redirectUri);
    return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  });
}

const reject = (error: string, description: string): Rejection => ({
  ok: false,
  status: 400,
  body: { error, error_description: description },
});

export async function registerClient(
  body: unknown,
): Promise<{ ok: true; status: 201; body: Record<string, unknown> } | Rejection> {
  const b = (body ?? {}) as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!urisWellFormed(uris)) {
    return reject(
      "invalid_redirect_uri",
      `redirect_uris must be 1 to ${MAX_URIS} URLs of at most ${MAX_URI_LEN} characters`,
    );
  }
  const appType =
    b.application_type === "web" || b.application_type === "native" ? b.application_type : null;
  const bad = uris.find((u) => !validRedirect(u, appType));
  if (bad) {
    return reject("invalid_redirect_uri", `Redirect URI not allowed: ${bad.slice(0, 200)}`);
  }
  const name = typeof b.client_name === "string" ? b.client_name.slice(0, 100) : "MCP client";
  const clientId = seal("client", { name, redirectUris: uris, applicationType: appType }, null);
  return {
    ok: true,
    status: 201,
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      application_type: appType ?? undefined,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DOC) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

function isPublicHost(rawHostname: string): boolean {
  const hostname = rawHostname.replace(/\.$/, "");
  if (
    LOOPBACK.has(hostname) ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  )
    return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const [a, b] = hostname.split(".").map(Number);
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
      return false;
  }
  return !hostname.startsWith("[");
}

async function fetchCimd(url: string): Promise<OAuthClient | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hash || u.username || u.password || !isPublicHost(u.hostname))
    return null;
  const hit = cimdCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.client;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_DOC) return null;
    const text = await readCapped(res);
    if (text === null) return null;
    const doc = JSON.parse(text) as Record<string, unknown>;
    if (doc.client_id !== url) return null;
    const uris = doc.redirect_uris;
    if (!urisWellFormed(uris)) return null;
    const appType =
      doc.application_type === "web" || doc.application_type === "native"
        ? doc.application_type
        : null;
    if (uris.some((x) => !validRedirect(x, appType))) return null;
    const client: OAuthClient = {
      clientId: url,
      kind: "cimd",
      name: typeof doc.client_name === "string" ? doc.client_name.slice(0, 100) : u.hostname,
      redirectUris: uris,
      applicationType: appType,
    };
    if (cimdCache.size >= CACHE_MAX) {
      const oldest = cimdCache.keys().next().value;
      if (oldest !== undefined) cimdCache.delete(oldest);
    }
    cimdCache.set(url, { client, at: Date.now() });
    return client;
  } catch {
    return null;
  }
}

export async function resolveClient(clientId: string): Promise<OAuthClient | null> {
  if (clientId.startsWith("https://")) return fetchCimd(clientId);
  const c = unseal<{
    name: string;
    redirectUris: string[];
    applicationType: OAuthClient["applicationType"];
  }>("client", clientId);
  if (!c) return null;
  return {
    clientId,
    kind: "dcr",
    name: c.name,
    redirectUris: c.redirectUris,
    applicationType: c.applicationType,
  };
}
