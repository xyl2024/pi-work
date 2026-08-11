/**
 * Server-side shared types for the MCP client.
 *
 * Defined here (not in `lib/mcp/mcp-client-types.ts`) because they are
 * used by the manager, transport, REST routes, and config-store —
 * server-only modules. Client-side code that only needs the on-the-wire
 * shapes should import the trimmed constants/types from
 * `mcp-client-types.ts` instead, to avoid pulling `@modelcontextprotocol/sdk`
 * into the browser bundle.
 */

// ── Config file shape (persisted to ~/.pi-work/mcp.json) ───────────────

export type McpTransport = "stdio" | "http";

export interface McpStdioServerConfig {
  enabled: boolean;
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout_ms?: number;
}

export interface McpHttpServerConfig {
  enabled: boolean;
  transport: "http";
  url: string;
  headers?: Record<string, string>;
  timeout_ms?: number;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface McpConfig {
  enabled: boolean;
  servers: McpServerConfig[];
}

export const DEFAULT_MCP_CONFIG: McpConfig = {
  enabled: false,
  servers: [],
};

// ── Runtime / view types ──────────────────────────────────────────────

export type McpConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/** Per-tool info cached after `client.listTools()`. */
export interface McpToolInfo {
  name: string;
  /** Capped at 4 KiB to keep the chat payload bounded. */
  description?: string;
  /** Raw JSON Schema object; UI passes this back as arguments verbatim. */
  inputSchema: unknown;
}

/** Union element of `CallToolResult.content` — only the parts we surface. */
export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "audio"; mimeType: string; data: string }
  | { type: "resource"; resource: unknown };

/** Return shape of `callTool`. */
export interface McpCallResult {
  isError: boolean;
  content: McpContent[];
}

/** One server's runtime view as the REST API exposes it. */
export interface McpServerView {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  status: McpConnectionStatus;
  error?: string;
  /** Tool count is included only when connected. */
  tools?: number;
  /** Available tool names (for the right-pane picker). */
  toolNames?: string[];
  connectedAt?: number;
}
