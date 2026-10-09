import { beforeEach, describe, expect, it } from "vitest";
import type { Attachment } from "./types";
import { fileUrl, r2Config, serveFile, sigV4, signFileId, verifyFileSig } from "./files";

beforeEach(() => {
  process.env.FILES_SECRET = "test-files-secret";
});

describe("signed file URLs with expiry", () => {
  const now = Date.UTC(2026, 9, 14, 12);
  const exp = Math.floor(now / 1000) + 600;

  it("accepts a valid sig before expiry and rejects it after", () => {
    const sig = signFileId(7, exp);
    expect(verifyFileSig(7, sig, String(exp), now)).toBe(true);
    expect(verifyFileSig(7, sig, String(exp), (exp + 1) * 1000)).toBe(false);
  });

  it("rejects a tampered or missing expiry", () => {
    const sig = signFileId(7, exp);
    expect(verifyFileSig(7, sig, String(exp + 3600), now)).toBe(false);
    expect(verifyFileSig(7, sig, null, now)).toBe(false);
    expect(verifyFileSig(7, signFileId(7), String(exp), now)).toBe(false);
    expect(verifyFileSig(7, sig, "abc", now)).toBe(false);
  });

  it("fileUrl adds exp only when a ttl is given", () => {
    expect(fileUrl(7)).toMatch(/\/api\/files\/7\?sig=[\w-]+$/);
    const u = new URL(fileUrl(7, { ttlSeconds: 600, now }));
    expect(u.searchParams.get("exp")).toBe(String(exp));
    expect(verifyFileSig(7, u.searchParams.get("sig"), u.searchParams.get("exp"), now)).toBe(true);
  });
});

describe("sigV4", () => {
  // AWS SigV4 test suite "get-vanilla"
  it("matches the AWS reference signature", () => {
    const h = sigV4({
      method: "GET",
      url: "https://example.amazonaws.com/",
      headers: {},
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      region: "us-east-1",
      service: "service",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      date: new Date("2015-08-30T12:36:00Z"),
    });
    expect(h["x-amz-date"]).toBe("20150830T123600Z");
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });
});

const R2_ENV = {
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "akid",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "etm",
  R2_PUBLIC_URL: "https://files.example.com/",
};

describe("r2Config", () => {
  it("is on only when all five R2 vars are set", () => {
    expect(r2Config({})).toBeNull();
    expect(r2Config({ ...R2_ENV, R2_BUCKET: "" })).toBeNull();
    expect(r2Config(R2_ENV)?.publicUrl).toBe("https://files.example.com");
  });
});

const file = {
  id: 12,
  telegramFileId: "FILEID",
  telegramFileUniqueId: "UNIQ",
  kind: "photo",
  mime: null,
  fileName: "Säle plan.pdf",
  r2Key: null,
} as unknown as Attachment;

type Call = { url: string; method: string; headers: Headers };
function fakeFetch(routes: (c: Call) => Response | undefined) {
  const calls: Call[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const c = { url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers) };
    calls.push(c);
    return routes(c) ?? new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

const telegram = (c: Call) => {
  if (c.url.endsWith("/getFile")) return Response.json({ ok: true, result: { file_path: "photos/f.jpg" } });
  if (c.url.includes("/file/botTOKEN/photos/f.jpg"))
    return new Response("JPEGBYTES", { headers: { "content-type": "image/jpeg", "content-length": "9" } });
};

describe("serveFile adapter selection", () => {
  it("streams from Telegram when R2 is not configured", async () => {
    const { f, calls } = fakeFetch(telegram);
    const res = await serveFile(file, { fetch: f, env: { TELEGRAM_BOT_TOKEN: "TOKEN" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("JPEGBYTES");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-length")).toBe("9");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400, immutable");
    expect(res.headers.get("content-disposition")).toBe("inline; filename*=UTF-8''S%C3%A4le%20plan.pdf");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.telegram.org/botTOKEN/getFile",
      "https://api.telegram.org/file/botTOKEN/photos/f.jpg",
    ]);
  });

  it("uses the given max-age for expiring links", async () => {
    const { f } = fakeFetch(telegram);
    const res = await serveFile(file, { fetch: f, env: { TELEGRAM_BOT_TOKEN: "TOKEN" }, maxAge: 120 });
    expect(res.headers.get("cache-control")).toBe("public, max-age=120");
  });

  it("returns 503 without a bot token and 410 when Telegram lost the file", async () => {
    expect((await serveFile(file, { fetch: fakeFetch(() => undefined).f, env: {} })).status).toBe(503);
    const gone = fakeFetch((c) => (c.url.endsWith("/getFile") ? Response.json({ ok: false }) : undefined));
    expect((await serveFile(file, { fetch: gone.f, env: { TELEGRAM_BOT_TOKEN: "TOKEN" } })).status).toBe(410);
  });

  it("redirects to the public R2 URL when the object is already mirrored", async () => {
    const { f, calls } = fakeFetch((c) => (c.method === "HEAD" ? new Response(null, { status: 200 }) : undefined));
    const res = await serveFile(file, { fetch: f, env: { ...R2_ENV, TELEGRAM_BOT_TOKEN: "TOKEN" } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://files.example.com/attachments/12-UNIQ");
    expect(calls).toHaveLength(1);
  });

  it("mirrors to R2 on first fetch and serves the bytes", async () => {
    const { f, calls } = fakeFetch((c) => {
      if (c.method === "PUT") return new Response(null, { status: 200 });
      return telegram(c);
    });
    const res = await serveFile(file, { fetch: f, env: { ...R2_ENV, TELEGRAM_BOT_TOKEN: "TOKEN" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("JPEGBYTES");
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("https://acct.r2.cloudflarestorage.com/etm/attachments/12-UNIQ");
    expect(put.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=akid\/\d{8}\/auto\/s3\/aws4_request/);
    expect(put.headers.get("content-type")).toBe("image/jpeg");
  });

  it("still serves the file when the R2 upload fails", async () => {
    const { f } = fakeFetch((c) => (c.method === "PUT" ? new Response("denied", { status: 403 }) : telegram(c)));
    const res = await serveFile(file, { fetch: f, env: { ...R2_ENV, TELEGRAM_BOT_TOKEN: "TOKEN" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("JPEGBYTES");
  });
});
