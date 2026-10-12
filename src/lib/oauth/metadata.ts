import { MCP_PATH } from "./authorize";

// Built from the origin the request came in on, not SITE_URL: clients check that the protected resource metadata names
// the exact URL they connected to, so it must be right on whichever domain (vercel.app or a custom one) they used.
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

export function authServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/settings`,
  };
}

export function protectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    resource_name: "Edge Tasks",
  };
}

/** The 401 header that points an MCP client at the metadata above (RFC 9728). */
export function wwwAuthenticate(origin: string, tokenPresented: boolean): string {
  const error = tokenPresented ? 'error="invalid_token", ' : "";
  return `Bearer ${error}resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
}
