import { db } from "@/db";
import { verifyFileSig } from "@/lib/files";
import * as attachmentsSvc from "@/services/attachments";

/**
 * Public, signed attachment URL: /api/files/<id>?sig=<hmac>. Streams from Telegram (getFile), or R2 later.
 * Signed = no enumeration, and AI clients can fetch it without auth.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  const sig = new URL(req.url).searchParams.get("sig");
  if (!Number.isInteger(id) || !verifyFileSig(id, sig)) return new Response("Not found", { status: 404 });
  const file = await attachmentsSvc.getById(db(), id);
  if (!file) return new Response("Not found", { status: 404 });
  // ponytail: R2 mirror not built yet; r2Key rows fall through to Telegram until it is
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return new Response("Files unavailable", { status: 503 });

  const meta = (await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id: file.telegramFileId }),
  }).then((r) => r.json())) as { ok: boolean; result?: { file_path?: string } };
  if (!meta.ok || !meta.result?.file_path) return new Response("File expired on Telegram", { status: 410 });

  const upstream = await fetch(`https://api.telegram.org/file/bot${token}/${meta.result.file_path}`);
  if (!upstream.ok || !upstream.body) return new Response("Upstream error", { status: 502 });
  return new Response(upstream.body, {
    headers: {
      "content-type": file.mime || upstream.headers.get("content-type") || (file.kind === "photo" ? "image/jpeg" : "application/octet-stream"),
      "cache-control": "public, max-age=86400, immutable",
      ...(file.fileName ? { "content-disposition": `inline; filename="${file.fileName.replace(/"/g, "")}"` } : {}),
    },
  });
}
