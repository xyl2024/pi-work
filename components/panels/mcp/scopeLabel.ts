import type { McpScope } from "@/lib/shared/mcp-panel";

export function mcpScopeLabelKey(scope: McpScope): "mcp.global" | "mcp.project" {
  return scope === "global" ? "mcp.global" : "mcp.project";
}
