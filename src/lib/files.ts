import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SITE_URL } from "./constants";
import type { Attachment } from "./types";

type Env = Record<string, string | undefined>;

function secret() {
  const s = process.env.FILES_SECRET || process.env.SESSION_SECRET;
  if (!s) throw new Error("FILES_SECRET or SESSION_SECRET must be set");
  return s;
}

/**
 * Attachments are public by signed URL: no enumeration, and AI clients can fetch them without auth.
 * `exp` (unix seconds) is optional; when given it is part of the signed payload, so it cannot be extended.
 */
export function signFileId(id: number, exp?: number): string {
  const payload = exp === undefined ? `file:${id}` : `file:${id}:${exp}`;
  return createHmac("sha256", secret()).update(payload).digest("base64url").slice(0, 32);
}

export function verifyFileSig(
  id: number,
  sig: string | null | undefined,
  exp?: string | null,
  now = Date.now(),
): boolean {
  if (!sig) return false;
  let expected: string;
  if (exp == null) expected = signFileId(id);
  else {
    const e = Number(exp);
    if (!/^\d+$/.test(exp) || e * 1000 < now) return false;
    expected = signFileId(id, e);
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function fileUrl(id: number, opts: { ttlSeconds?: number; now?: number } = {}): string {
  if (!opts.ttlSeconds) return `${SITE_URL}/api/files/${id}?sig=${signFileId(id)}`;
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + opts.ttlSeconds;
  return `${SITE_URL}/api/files/${id}?sig=${signFileId(id, exp)}&exp=${exp}`;
}

// ---- R2 (S3 API) ----

export type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicUrl: string };

/** R2 is used only when all five vars are set; otherwise files stream straight from Telegram. */
export function r2Config(env: Env = process.env): R2Config | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_URL) return null;
  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
    publicUrl: R2_PUBLIC_URL.replace(/\/+$/, ""),
  };
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/**
 * AWS Signature V4 headers (authorization + x-amz-date). Signs host plus every header passed.
 * ponytail: no query-string canonicalisation; only used for path-only PUTs to R2.
 */
export function sigV4(o: {
  method: string;
  url: string;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
}): { authorization: string; "x-amz-date": string } {
  const u = new URL(o.url);
  const amzDate = o.date.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const h: Record<string, string> = { host: u.host, "x-amz-date": amzDate };
  for (const [k, v] of Object.entries(o.headers)) h[k.toLowerCase()] = v.trim();
  const names = Object.keys(h).sort();
  const signed = names.join(";");
  const canonical = [o.method, u.pathname, "", names.map((n) => `${n}:${h[n]}\n`).join(""), signed, o.payloadHash].join("\n");
  const scope = `${day}/${o.region}/${o.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let key = hmac(`AWS4${o.secretAccessKey}`, day);
  for (const part of [o.region, o.service, "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    "x-amz-date": amzDate,
  };
}

/** Stable key, so a mirrored object is found again without storing anything in the DB. */
export const r2KeyFor = (f: Pick<Attachment, "id" | "telegramFileUniqueId" | "r2Key">) =>
  f.r2Key ?? `attachments/${f.id}-${f.telegramFileUniqueId}`;

async function r2Put(cfg: R2Config, key: string, body: Uint8Array, contentType: string, fetchFn: typeof fetch) {
  const url = `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${key}`;
  const headers = { "content-type": contentType, "x-amz-content-sha256": sha256(body) };
  const auth = sigV4({
    method: "PUT",
    url,
    headers,
    payloadHash: headers["x-amz-content-sha256"],
    region: "auto",
    service: "s3",
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    date: new Date(),
  });
  const res = await fetchFn(url, { method: "PUT", headers: { ...headers, ...auth }, body: body as BodyInit });
  if (!res.ok) throw new Error(`R2 PUT ${res.status}`);
}

// ---- serving ----

const DAY = 86400;
const noStore = (body: string, status: number) => new Response(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Body of GET /api/files/<id> once the signature checks out. Without R2: stream from Telegram getFile.
 * With R2: redirect to the public object, mirroring it from Telegram on the first fetch.
 * `maxAge` caps caching for expiring links (seconds left); default is a day, immutable.
 */
export async function serveFile(
  file: Attachment,
  opts: { fetch?: typeof fetch; env?: Env; maxAge?: number } = {},
): Promise<Response> {
  const fetchFn = opts.fetch ?? fetch;
  const env = opts.env ?? process.env;
  const cacheControl =
    opts.maxAge === undefined ? `public, max-age=${DAY}, immutable` : `public, max-age=${Math.max(0, Math.min(DAY, opts.maxAge))}`;

  const r2 = r2Config(env);
  const key = r2KeyFor(file);
  if (r2) {
    const publicUrl = `${r2.publicUrl}/${key}`;
    const head = await fetchFn(publicUrl, { method: "HEAD" }).catch(() => null);
    if (head?.ok) return new Response(null, { status: 302, headers: { location: publicUrl, "cache-control": cacheControl } });
  }

  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return noStore("Files unavailable", 503);
  let upstream: Response;
  try {
    const meta = (await fetchFn(`https://api.telegram.org/bot${token}/getFile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: file.telegramFileId }),
    }).then((r) => r.json())) as { ok: boolean; result?: { file_path?: string } };
    if (!meta.ok || !meta.result?.file_path) return noStore("File expired on Telegram", 410);
    upstream = await fetchFn(`https://api.telegram.org/file/bot${token}/${meta.result.file_path}`);
  } catch {
    return noStore("Upstream error", 502);
  }
  if (!upstream.ok || !upstream.body) return noStore("Upstream error", 502);

  const contentType =
    file.mime || upstream.headers.get("content-type") || (file.kind === "photo" ? "image/jpeg" : "application/octet-stream");
  const headers: Record<string, string> = { "content-type": contentType, "cache-control": cacheControl };
  if (file.fileName) headers["content-disposition"] = `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`;

  if (r2) {
    // ponytail: buffers the file (Telegram bot downloads cap at 20 MB) so one read feeds both R2 and the client
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    await r2Put(r2, key, bytes, contentType, fetchFn).catch((e) => console.error("R2 mirror failed", file.id, e));
    return new Response(bytes, { headers: { ...headers, "content-length": String(bytes.byteLength) } });
  }
  const len = upstream.headers.get("content-length");
  if (len) headers["content-length"] = len;
  return new Response(upstream.body, { headers });
}
