import type { McpScope } from "@/lib/shared/mcp-panel";

/** The i18n key for one scope's human label — declared once, read everywhere. */
export function mcpScopeLabelKey(scope: McpScope): "mcp.global" | "mcp.project" {
  return scope === "global" ? "mcp.global" : "mcp.project";
}
