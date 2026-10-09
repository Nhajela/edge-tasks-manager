import { db } from "@/db";
import { serveFile, verifyFileSig } from "@/lib/files";
import * as attachmentsSvc from "@/services/attachments";

/**
 * Public, signed attachment URL: /api/files/<id>?sig=<hmac>[&exp=<unix seconds>].
 * Signed = no enumeration, and AI clients can fetch it without auth. Telegram or R2 is picked in serveFile.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  const params = new URL(req.url).searchParams;
  const exp = params.get("exp");
  const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  if (!Number.isInteger(id) || !verifyFileSig(id, params.get("sig"), exp)) return notFound();
  const file = await attachmentsSvc.getById(db(), id);
  if (!file) return notFound();
  return serveFile(file, { maxAge: exp ? Number(exp) - Math.floor(Date.now() / 1000) : undefined });
}
