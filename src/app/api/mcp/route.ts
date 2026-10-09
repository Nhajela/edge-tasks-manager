import { createMcpHandler, isLegacyRequest, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { db } from "@/db";
import { actorFromToken } from "@/lib/actor";
import { createMcpServer } from "@/lib/mcp/server";
import * as people from "@/services/people";
import * as tokens from "@/services/tokens";
import type { Actor } from "@/services/types";

// Stateless streamable HTTP (pattern from eci-events-mcp): a fresh McpServer per request, acting as the token's
// person. Current clients go through createMcpHandler; 2025-era clients (initialize handshake) get a per-request
// transport with JSON responses, since the SDK's legacy fallback always answers with SSE.
const handler = createMcpHandler(
  ({ authInfo }) => {
    const actor = authInfo?.extra?.actor as Actor | undefined;
    if (!actor) throw new Error("MCP handler invoked without an actor");
    return createMcpServer(actor);
  },
  { legacy: "reject", responseMode: "json" },
);

async function serveLegacy(request: Request, actor: Actor): Promise<Response> {
  const server = createMcpServer(actor);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await server.close().catch(() => {});
  }
}

async function resolveActor(header: string | null): Promise<Actor | null> {
  const raw = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!raw) return null;
  const hit = await tokens.verify(db(), raw);
  const person = hit && (await people.getById(db(), hit.personId));
  return person ? actorFromToken(person) : null;
}

export async function POST(request: Request): Promise<Response> {
  const actor = await resolveActor(request.headers.get("authorization"));
  if (!actor)
    return Response.json(
      { error: "unauthorized", error_description: "Send Authorization: Bearer etm_… (make a token on /settings)." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="edge-tasks"' } },
    );
  if (await isLegacyRequest(request)) return serveLegacy(request, actor);
  return handler.fetch(request, { authInfo: { token: "[sealed]", clientId: "etm", scopes: [], extra: { actor } } });
}

export function GET(): Response {
  return Response.json({ error: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
}

export const DELETE = GET;
