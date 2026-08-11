/**
 * Client-safe constants and types for MCP.
 *
 * MUST NOT import `@modelcontextprotocol/sdk`, `fs`, `path`, or any
 * server-only module. Client components (`components/McpConfig.tsx`)
 * import from here to keep the SDK's transitive deps out of the
 * browser bundle.
 *
 * The richer runtime shapes (e.g. `McpToolInfo`) live in `lib/mcp/types.ts`
 * and are server-only — the UI infers shapes from `fetch` JSON responses
 * rather than importing TypeScript types for them.
 */

export const MCP_CONFIG_FILE = "mcp.json";

/** Re-export the connection-status string set so client code can colour-code
 *  the status chip without importing the SDK. */
export type McpConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export const MCP_STATUS_LABEL_KEY: Record<McpConnectionStatus, string> = {
  disconnected: "MCP status: disconnected",
  connecting: "MCP status: connecting",
  connected: "MCP status: connected",
  error: "MCP status: error",
};
