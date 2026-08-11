/**
 * Read/write `~/.pi-work/mcp.json` with fail-open semantics.
 *
 * Mirrors `lib/todo-tools-config.ts`:
 *  - Missing file / JSON parse error → return `DEFAULT_MCP_CONFIG`,
 *    leave the file untouched (do not auto-create to avoid surprising
 *    the user with an empty `mcp.json`).
 *  - Unknown server entries (bad transport / missing fields) are dropped
 *    with `log.warn` rather than crashing the manager; this matters
 *    because the manager reads the file on every `connect()`.
 *
 * Writes are atomic: write to `<path>.tmp`, then rename. A crash
 * mid-write leaves the previous file intact.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createLogger } from "../logger";
import {
  DEFAULT_MCP_CONFIG,
  type McpConfig,
  type McpHttpServerConfig,
  type McpServerConfig,
  type McpStdioServerConfig,
  type McpTransport,
} from "./types";

const log = createLogger("mcp-config");

const CONFIG_DIR = join(homedir(), ".pi-work");
const CONFIG_PATH = join(CONFIG_DIR, "mcp.json");

function isTransport(value: unknown): value is McpTransport {
  return value === "stdio" || value === "http";
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

/**
 * Validate one raw server entry. Returns a normalised McpServerConfig
 * or `undefined` if the entry is unusable (missing transport, unknown
 * shape, missing required fields). Caller decides whether to log.
 */
export function parseServer(raw: unknown): McpServerConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const enabled = obj.enabled !== false; // missing → true
  const transport = obj.transport;
  if (!isTransport(transport)) return undefined;
  const timeout_ms = asPositiveInt(obj.timeout_ms);
  if (transport === "stdio") {
    if (typeof obj.command !== "string" || obj.command.length === 0) return undefined;
    const out: McpStdioServerConfig = {
      enabled,
      transport: "stdio",
      command: obj.command,
    };
    if (Array.isArray(obj.args) && obj.args.every((a) => typeof a === "string")) {
      out.args = obj.args as string[];
    }
    if (obj.env && typeof obj.env === "object") {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj.env as Record<string, unknown>)) {
        if (typeof v === "string") env[k] = v;
      }
      if (Object.keys(env).length > 0) out.env = env;
    }
    if (typeof obj.cwd === "string" && obj.cwd.length > 0) out.cwd = obj.cwd;
    if (timeout_ms !== undefined) out.timeout_ms = timeout_ms;
    return out;
  }
  // http
  if (typeof obj.url !== "string" || obj.url.length === 0) return undefined;
  const out: McpHttpServerConfig = {
    enabled,
    transport: "http",
    url: obj.url,
  };
  if (obj.headers && typeof obj.headers === "object") {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj.headers as Record<string, unknown>)) {
      if (typeof v === "string") headers[k] = v;
    }
    if (Object.keys(headers).length > 0) out.headers = headers;
  }
  if (timeout_ms !== undefined) out.timeout_ms = timeout_ms;
  return out;
}

function parseConfig(raw: unknown): McpConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MCP_CONFIG, servers: [] };
  const obj = raw as Record<string, unknown>;
  const enabled = obj.enabled !== false;
  const rawServers = Array.isArray(obj.servers) ? obj.servers : [];
  const seen = new Set<string>();
  const servers: McpServerConfig[] = [];
  for (const r of rawServers) {
    const parsed = parseServer(r);
    if (!parsed) {
      log.warn("dropping malformed mcp server entry");
      continue;
    }
    if (typeof (r as { name?: unknown }).name !== "string") {
      log.warn("dropping mcp server without name", { transport: parsed.transport });
      continue;
    }
    const name = (r as { name: string }).name;
    if (seen.has(name)) {
      log.warn("dropping duplicate mcp server name", { name });
      continue;
    }
    seen.add(name);
    // Attach the name to a clone — parseServer leaves it off so the
    // raw JSON shape (no `name` field required for the URL path) stays
    // optional. The manager keys handles by the top-level `name`.
    servers.push({ name, ...parsed } as unknown as McpServerConfig);
  }
  return { enabled, servers };
}

/** Read the config. Missing / corrupt file → defaults, no exception. */
export function readMcpConfig(): McpConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_MCP_CONFIG, servers: [] };
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parseConfig(parsed);
  } catch (err) {
    log.warn("failed to read/parse mcp.json, falling back to defaults", {
      error: String(err),
    });
    return { ...DEFAULT_MCP_CONFIG, servers: [] };
  }
}

/** For tests / tooling — the on-disk path. */
export function getMcpConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Validate an incoming config and return the clean version, or throw
 * with a human-readable error. Used by `PUT /api/mcp/config`.
 */
export function validateMcpConfig(raw: unknown): McpConfig {
  const parsed = parseConfig(raw);
  // After parseConfig, names are guaranteed unique + transports valid +
  // required fields present. We additionally check the top-level shape
  // so a totally-wrong input (e.g. an array) is rejected outright.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("mcp config must be an object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled !== "boolean") {
    // parseConfig defaults to true when missing, so an explicit non-boolean
    // here is a user error.
    throw new Error('"enabled" must be a boolean');
  }
  if (obj.servers !== undefined && !Array.isArray(obj.servers)) {
    throw new Error('"servers" must be an array');
  }
  return parsed;
}

/** Atomic write: tmp + rename. Throws on I/O failure. */
export function writeMcpConfig(config: McpConfig): void {
  const cleaned: McpConfig = {
    enabled: Boolean(config.enabled),
    servers: (config.servers ?? []).map((s) => {
      return { ...s } as McpServerConfig;
    }),
  };
  mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(cleaned, null, 2) + "\n", "utf8");
  renameSync(tmp, CONFIG_PATH);
  log.info("mcp.json written", { servers: cleaned.servers.length });
}
