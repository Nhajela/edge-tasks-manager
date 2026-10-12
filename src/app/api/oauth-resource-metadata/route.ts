import { protectedResourceMetadata, requestOrigin } from "@/lib/oauth/metadata";

const headers = { "Access-Control-Allow-Origin": "*" };

export function GET(request: Request) {
  return Response.json(protectedResourceMetadata(requestOrigin(request)), { headers });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { ...headers, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "content-type" },
  });
}
