import { db } from "@/db";
import { actorFromSession } from "@/lib/actor";
import { decide, startAuthorize } from "@/lib/oauth/authorize";
import { requestOrigin } from "@/lib/oauth/metadata";
import { getSession } from "@/lib/session";

const text = (status: number, message: string) => new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function GET(request: Request) {
  const origin = requestOrigin(request);
  const r = await startAuthorize(new URL(request.url).searchParams, origin);
  if (r.kind === "redirect") return Response.redirect(new URL(r.location, origin), 302);
  return text(r.status, r.message);
}

/**
 * The Allow / Don't allow form on /connect. A plain form post rather than a server action, so the 303 can go to a
 * native app's own scheme (cursor://…). Cross-site posts are refused twice: the session cookie is SameSite=Lax, so it
 * isn't sent, and the Origin header must be this site.
 */
export async function POST(request: Request) {
  const origin = requestOrigin(request);
  const from = request.headers.get("origin");
  if (from && from !== origin) return text(403, "This form only works from this site.");
  const session = await getSession();
  if (!session) return text(401, "Log in first, then connect again from your AI app.");
  const form = await request.formData();
  const { actor } = await actorFromSession(db(), session);
  const location = await decide(db(), actor, String(form.get("req") ?? ""), form.get("decision") === "allow", origin);
  if (!location) return text(400, "This sign-in link expired. Go back to your AI app and connect again.");
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}
