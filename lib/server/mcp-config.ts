import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, type LoadedMcpConfig, type McpExposure, type McpServerConfig, type McpServerEntry } from "@earendil-works/pi-coding-agent";
import { MCP_EXPOSURE_ALIASES } from "@/lib/shared/mcp-panel";
import { createLogger } from "./logger";

const log = createLogger("mcp-config");

/**
 * Pi Work's own `mcp.json` loader for pi's built-in MCP extension.
 *
 * `createMcpExtension()` reads `mcp.json` through `loadMcpConfig()` by
 * default, which trusts the project file whenever the session's
 * `SettingsManager` says the project is trusted — and the SDK creates that
 * manager with `projectTrusted: true`. Pi Work must not follow that default
 * blindly: a stdio entry spawns an arbitrary command, and a Pi Work session can
 * be reached from the LAN. So we hand the extension our own loader, which
 * always reads the global file and reads `<cwd>/.pi/mcp.json` only when
 * `PiWorkConfig.mcp.project_servers` turns it on.
 *
 * The file format, the merge rule (project entries replace global ones by
 * name) and the validation are pi's. `loadMcpConfig` / `validateMcpServerConfig`
 * are not exported from the package root (`exports` only opens `.` and
 * `./rpc-entry`; 1.2.0 dropped `./client` and `./experimental/plugin`), so the shape checks
 * below are a deliberate mirror of `dist/core/mcp-servers.js`. When pi changes
 * that validator, this has to change with it; `tests/unit/mcp-config.test.ts`
 * pins the rules that matter.
 */

const MCP_EXPOSURES: readonly McpExposure[] = ["codemode", "deferred", "direct", "hidden"];

// `MCP_EXPOSURE_ALIASES` (imported above) mirrors pi's table of the same name:
// exposure names pi no longer lists but still accepts, mapped to the name they
// now stand for. pi resolves them while validating, so a session and this
// mirror only ever see the current name. `codemode-deferred` was its own level
// until 1.1.0 folded "not listed in the codemode description" into `codemode`
// itself; the table lives with the panel's exposure UI so both halves read the
// same one.

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/** Localhost redirect URIs pi's loopback callback server can serve. */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isLoopbackRedirectUri(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname) && url.search === "" && url.hash === "";
}

function isExposure(value: unknown): value is McpExposure {
  return typeof value === "string" && (MCP_EXPOSURES as readonly string[]).includes(value);
}

/** The exposure an alias stands for; other values are returned unchanged. */
function resolveExposureAlias(value: unknown): unknown {
  return typeof value === "string" ? (MCP_EXPOSURE_ALIASES[value] ?? value) : value;
}

/** A copy of the entry with exposure aliases replaced by their current names. */
function resolveExposureAliases(value: Record<string, unknown>): Record<string, unknown> {
  const resolved = { ...value };
  if (resolved.exposure !== undefined) resolved.exposure = resolveExposureAlias(resolved.exposure);
  const toolExposure = resolved.toolExposure;
  if (isRecord(toolExposure)) {
    resolved.toolExposure = Object.fromEntries(
      Object.entries(toolExposure).map(([tool, exposure]) => [tool, resolveExposureAlias(exposure)]),
    );
  }
  return resolved;
}

function validateOAuth(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return "oauth must be an object";
  if (value.clientId !== undefined && typeof value.clientId !== "string") return "oauth.clientId must be a string";
  if (value.clientSecret !== undefined && typeof value.clientSecret !== "string") {
    return "oauth.clientSecret must be a string";
  }
  const port = value.callbackPort;
  if (port !== undefined && (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)) {
    return "oauth.callbackPort must be a port number";
  }
  if (value.callbackUrl !== undefined) {
    if (typeof value.callbackUrl !== "string" || !isLoopbackRedirectUri(value.callbackUrl)) {
      return "oauth.callbackUrl must be an http URI on localhost, 127.0.0.1, or [::1] without query or fragment";
    }
    const urlPort = new URL(value.callbackUrl).port;
    if (urlPort && port !== undefined && Number(urlPort) !== port) {
      return "oauth.callbackUrl and oauth.callbackPort name different ports";
    }
  }
  if (value.scope !== undefined && typeof value.scope !== "string") return "oauth.scope must be a string";
  if (value.clientName !== undefined && (typeof value.clientName !== "string" || !value.clientName.trim())) {
    return "oauth.clientName must be a non-empty string";
  }
  if (value.clientRegistration !== undefined && value.clientRegistration !== "dcr") {
    if (value.clientRegistration !== "cimd") return 'oauth.clientRegistration must be "dcr" or "cimd"';
    if (value.clientId !== undefined || value.clientName !== undefined) {
      return 'oauth.clientRegistration "cimd" cannot be combined with oauth.clientId or oauth.clientName';
    }
    const callback = typeof value.callbackUrl === "string" ? new URL(value.callbackUrl) : undefined;
    if (callback && (callback.hostname === "[::1]" || callback.pathname !== "/callback")) {
      return 'oauth.clientRegistration "cimd" requires oauth.callbackUrl on localhost or 127.0.0.1 with path /callback';
    }
  }
  const metadataUrl = value.authServerMetadataUrl;
  if (metadataUrl !== undefined) {
    const url = typeof metadataUrl === "string" && URL.canParse(metadataUrl) ? new URL(metadataUrl) : undefined;
    if (!url || !(url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname)))) {
      return "oauth.authServerMetadataUrl must be an https URL, or http on localhost, 127.0.0.1, or [::1]";
    }
  }
  return undefined;
}

/**
 * Validate one `mcpServers` entry. Returns the (unchanged) config when it is
 * usable, or a human-readable error. Mirror of pi's `validateMcpServerConfig`.
 *
 * `${NAME}` / `!command` references inside `env` and `headers` are NOT resolved
 * here: pi's transport resolves them at connect time, and resolving early would
 * freeze a value that the user expects to follow the environment.
 */
export function validateMcpServerConfig(name: string, value: unknown): McpServerConfig | string {
  if (!SERVER_NAME.test(name)) {
    return `invalid server name "${name}" (use letters, digits, "_" and "-")`;
  }
  if (!isRecord(value)) return `server "${name}" must be an object`;
  // pi resolves exposure aliases before validating, so the entry a session
  // connects with carries the current name. Returning the resolved copy keeps
  // this mirror equivalent to pi's, including what it reports in errors.
  const resolved = resolveExposureAliases(value);
  const { type, exposure, enabled, timeout, toolExposure, description } = resolved;
  const exposures = MCP_EXPOSURES.map((item) => `"${item}"`).join(", ");
  if (exposure !== undefined && !isExposure(exposure)) {
    return `server "${name}": exposure must be one of ${exposures}`;
  }
  if (toolExposure !== undefined) {
    if (!isRecord(toolExposure)) return `server "${name}": toolExposure must map tool names to exposures`;
    for (const [tool, toolValue] of Object.entries(toolExposure)) {
      if (!isExposure(toolValue)) {
        return `server "${name}": toolExposure "${tool}" must be one of ${exposures}`;
      }
    }
  }
  if (enabled !== undefined && typeof enabled !== "boolean") {
    return `server "${name}": enabled must be a boolean`;
  }
  if (description !== undefined && typeof description !== "string") {
    return `server "${name}": description must be a string`;
  }
  if (timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))) {
    return `server "${name}": timeout must be a positive number of seconds`;
  }
  if (type === "sse") {
    return `server "${name}": legacy SSE transport is not supported; use the streamable HTTP URL`;
  }
  if (typeof resolved.url === "string" && (type === undefined || type === "http" || type === "streamable-http")) {
    if (!URL.canParse(resolved.url) || !/^https?:$/.test(new URL(resolved.url).protocol)) {
      return `server "${name}": url must be an http or https URL`;
    }
    if (resolved.headers !== undefined && !isStringRecord(resolved.headers)) {
      return `server "${name}": headers must map names to strings`;
    }
    const oauthError = validateOAuth(resolved.oauth);
    if (oauthError) return `server "${name}": ${oauthError}`;
    if (resolved.auth !== undefined) {
      if (!isRecord(resolved.auth) || typeof resolved.auth.provider !== "string" || !resolved.auth.provider) {
        return `server "${name}": auth.provider must be a provider name`;
      }
      const url = new URL(resolved.url);
      if (url.protocol !== "https:" && !LOOPBACK_HOSTS.includes(url.hostname)) {
        return `server "${name}": auth requires an https URL, or http on localhost, 127.0.0.1, or [::1]`;
      }
    }
    return resolved as unknown as McpServerConfig;
  }
  if (typeof resolved.command === "string" && (type === undefined || type === "stdio")) {
    if (resolved.args !== undefined && !(Array.isArray(resolved.args) && resolved.args.every((arg) => typeof arg === "string"))) {
      return `server "${name}": args must be an array of strings`;
    }
    if (resolved.env !== undefined && !isStringRecord(resolved.env)) {
      return `server "${name}": env must map names to strings`;
    }
    if (resolved.cwd !== undefined && typeof resolved.cwd !== "string") {
      return `server "${name}": cwd must be a string`;
    }
    return resolved as unknown as McpServerConfig;
  }
  return `server "${name}" needs either "command" (stdio) or "url" (streamable HTTP)`;
}

interface LoadState {
  servers: Map<string, McpServerEntry>;
  errors: string[];
  autoEnableCodemode?: boolean;
}

function readConfigFile(path: string, scope: "global" | "project", state: LoadState): void {
  if (!existsSync(path)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    state.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
    state.errors.push(`${path}: expected an object with an "mcpServers" object`);
    return;
  }
  if (typeof parsed.autoEnableCodemode === "boolean") {
    state.autoEnableCodemode = parsed.autoEnableCodemode;
  } else if (parsed.autoEnableCodemode !== undefined) {
    state.errors.push(`${path}: autoEnableCodemode must be a boolean`);
  }
  for (const [name, value] of Object.entries((parsed.mcpServers as Record<string, unknown>) ?? {})) {
    const config = validateMcpServerConfig(name, value);
    if (typeof config === "string") {
      state.errors.push(`${path}: ${config}`);
      continue;
    }
    // Same shape as pi's loader: project entries replace global ones by name.
    state.servers.set(name, { name, config, source: path, scope });
  }
}

export interface LoadPiWorkMcpConfigOptions {
  agentDir: string;
  cwd: string;
  /** Whether the workspace's `.pi/mcp.json` may be read. */
  projectTrusted: boolean;
}

/**
 * Load the MCP servers one Pi Work session may connect: always the global
 * `~/.pi/agent/mcp.json`, plus the workspace file when trusted. Disabled
 * servers are kept (with `enabled: false`) so the extension can list them.
 *
 * Never throws: a broken file becomes an entry in `errors`, and the other
 * servers still connect.
 */
export function loadMcpConfigForPiWork(options: LoadPiWorkMcpConfigOptions): LoadedMcpConfig {
  const state: LoadState = { servers: new Map(), errors: [] };
  readConfigFile(join(options.agentDir, "mcp.json"), "global", state);
  if (options.projectTrusted) {
    readConfigFile(join(options.cwd, CONFIG_DIR_NAME, "mcp.json"), "project", state);
  }
  if (state.errors.length > 0) {
    // The extension reports these to the user as well; one log line makes the
    // server-side story greppable when the UI is not open.
    log.warn("mcp.json entries skipped", { count: state.errors.length, errors: state.errors, cwd: options.cwd });
  }
  return {
    servers: [...state.servers.values()],
    ...(state.autoEnableCodemode === undefined ? {} : { autoEnableCodemode: state.autoEnableCodemode }),
    errors: state.errors,
  };
}
