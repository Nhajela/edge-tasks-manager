import { requestOrigin } from "@/lib/oauth/metadata";
import { exchangeToken, parseTokenBody } from "@/lib/oauth/token";

const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };

export async function POST(request: Request) {
  try {
    const r = await exchangeToken(await parseTokenBody(request), requestOrigin(request));
    return Response.json(r.body, { status: r.status, headers });
  } catch (e) {
    // never log the body: it carries the code and verifier
    console.error("oauth token failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "server_error", error_description: "Something went wrong." }, { status: 500, headers });
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { ...headers, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "content-type" },
  });
}
