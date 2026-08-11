/**
 * Build an MCP `Transport` from a server config entry, with `${VAR}`
 * placeholder expansion for stdio `env` and http `headers`.
 *
 * Returns the raw SDK transport — the caller wires it into a new
 * `Client` and drives the lifecycle. We deliberately do not eagerly
 * connect here; that lives in `manager.ts` so the timeout + idle
 * timer policy stays in one place.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLogger } from "../logger";
import type { McpServerConfig } from "./types";

const log = createLogger("mcp-transport");

/** Replace `${VAR}` with `process.env.VAR`. Missing envs → empty string
 *  so the host gets a recognisable, empty header / env value rather
 *  than a literal `${VAR}` token leaking into the wire. We `log.warn`
 *  up-front so the user can spot the misconfiguration in their JSON. */
export function expandEnvPlaceholders(
  values: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!values) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const replaced = value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name: string) => {
      const v = process.env[name];
      if (v === undefined) log.warn("env placeholder unresolved", { key, name });
      return v ?? "";
    });
    out[key] = replaced;
  }
  return out;
}

export interface BuiltTransport {
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  /** Client identifier sent during `initialize`. */
  clientName: string;
}

/** Pick a stable, unique client name per server so MCP logs are
 *  traceable across multiple connections in the same process. */
export function clientNameFor(serverName: string): string {
  // MCP client names must be `[a-zA-Z0-9\-]+` per spec; replace any
  // user-provided slug characters that would surprise a server.
  return `pi-work-mcp:${serverName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function buildTransport(
  server: McpServerConfig & { name: string },
): BuiltTransport {
  if (server.transport === "stdio") {
    const params: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    } = { command: server.command };
    if (server.args && server.args.length > 0) params.args = server.args;
    const env = expandEnvPlaceholders(server.env);
    if (env) params.env = env;
    if (server.cwd) params.cwd = server.cwd;
    const transport = new StdioClientTransport(params);
    return { transport, clientName: clientNameFor(server.name) };
  }
  // http
  const headers = expandEnvPlaceholders(server.headers);
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    ...(headers ? { requestInit: { headers } } : {}),
  });
  return { transport, clientName: clientNameFor(server.name) };
}

/** Build a fresh `Client` with minimal capabilities — we only call
 *  `listTools` and `callTool`, so the empty capability set is correct. */
export function buildClient(name: string, version: string): Client {
  return new Client({ name, version }, { capabilities: {} });
}

/** Exported only so tests can stub version. App code uses the constant. */
export const MCP_CLIENT_VERSION = process.env.npm_package_version ?? "0.0.0";
