import { describe, expect, it } from "vitest";
import { mcpSnippets } from "./McpAccess";

describe("mcpSnippets", () => {
  const s = mcpSnippets("https://tasks.example.org", "etm_abc");

  it("builds the Claude Code command", () => {
    expect(s.claude).toBe(
      'claude mcp add --transport http edge-tasks https://tasks.example.org/api/mcp --header "Authorization: Bearer etm_abc"',
    );
  });

  it("builds valid JSON config with the bearer header", () => {
    expect(JSON.parse(s.json)).toEqual({
      mcpServers: {
        "edge-tasks": { type: "http", url: "https://tasks.example.org/api/mcp", headers: { Authorization: "Bearer etm_abc" } },
      },
    });
  });

  it("builds a curl tools/list check", () => {
    expect(s.curl).toContain("https://tasks.example.org/api/mcp");
    expect(s.curl).toContain('-H "Authorization: Bearer etm_abc"');
    expect(s.curl).toContain("text/event-stream");
    expect(s.curl).toContain('"method":"tools/list"');
  });
});
