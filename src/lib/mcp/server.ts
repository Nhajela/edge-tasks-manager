import type { McpServer } from "@modelcontextprotocol/server";
import type { Actor } from "@/services/types";

/**
 * A fresh, stateless MCP server acting as `actor` (the person behind the Bearer etm_ token; actorFromToken).
 * Tools (SPEC "MCP server"): whoami, list_requests, get_request, update_status, add_comment, create_request,
 * set_due, set_priority, each a thin call into src/services. /api/mcp builds one per request.
 * STUB: the MCP task fills this in.
 */
export function createMcpServer(actor: Actor): McpServer {
  void actor;
  throw new Error("createMcpServer: not implemented");
}
