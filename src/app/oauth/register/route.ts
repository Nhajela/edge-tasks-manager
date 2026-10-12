import { registerClient } from "@/lib/oauth/clients";

const headers = { "Access-Control-Allow-Origin": "*" };

export async function POST(request: Request) {
  const r = await registerClient(await request.json().catch(() => null));
  return Response.json(r.body, { status: r.status, headers });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { ...headers, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "content-type" },
  });
}
