import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// OAuth's in-flight artifacts (DCR client ids, the pending sign-in, codes) travel inside AES-256-GCM tokens instead of
// rows, so nothing but the issued etm_ token is stored. A code carries that raw token, so these are encrypted, not just
// signed. Rotating the secret breaks sign-ins in progress and DCR client ids (the assistant registers again); issued
// tokens are rows, so they keep working.
export type Sealed = "client" | "authreq" | "code";

function key(): Buffer {
  const s = process.env.OAUTH_SECRET || process.env.SESSION_SECRET;
  if (!s) throw new Error("OAUTH_SECRET or SESSION_SECRET must be set");
  return createHash("sha256").update(`etm-oauth:${s}`).digest();
}

/** `ttlSeconds` null means no expiry; only a DCR client id may live that long. */
export function seal(typ: Sealed, payload: Record<string, unknown>, ttlSeconds: number | null, now = Date.now()): string {
  if (ttlSeconds === null && typ !== "client") throw new Error(`seal(${typ}) needs a ttl`);
  const body = { ...payload, typ, ...(ttlSeconds === null ? {} : { exp: Math.floor(now / 1000) + ttlSeconds }) };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  return Buffer.concat([iv, enc, cipher.getAuthTag()]).toString("base64url");
}

export function unseal<T>(typ: Sealed, token: string, now = Date.now()): T | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const json = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
    const body = JSON.parse(json) as T & { typ: string; exp?: number };
    if (body.typ !== typ) return null;
    if (body.exp !== undefined && body.exp * 1000 < now) return null;
    return body;
  } catch {
    return null;
  }
}
