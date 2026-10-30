import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import {
  isMcpOverride,
  MCP_SCOPES,
  MCP_SERVER_NAME,
  mcpProjectAuthError,
  pruneMcpDefaults,
  type McpPanelChange,
  type McpPanelData,
  type McpPanelEntry,
  type McpPanelFile,
  type McpScope,
} from "@/lib/shared/mcp-panel";
import { resolveMcpOverride, validateMcpServerConfig } from "./mcp-config";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface McpFilePaths {
  agentDir: string;
  cwd: string;
}

export function mcpFilePath(scope: McpScope, paths: McpFilePaths): string {
  return scope === "global" ? join(paths.agentDir, "mcp.json") : join(paths.cwd, CONFIG_DIR_NAME, "mcp.json");
}

interface LoadedFile {
  file: McpPanelFile;
  raw: string | null;
  parsed: Record<string, unknown> | null;
  servers: Record<string, unknown> | null;
  autoEnableError: string | null;
}

function loadFile(scope: McpScope, path: string): LoadedFile {
  const empty: McpPanelFile = {
    scope,
    path,
    exists: false,
    parseError: null,
    autoEnableError: null,
    autoEnableCodemode: null,
  };
  if (!existsSync(path)) {
    return { file: empty, raw: null, parsed: null, servers: null, autoEnableError: null };
  }

  const raw = readFileSync(path, "utf8");
  const fail = (parseError: string): LoadedFile => ({
    file: { scope, path, exists: true, parseError, autoEnableError: null, autoEnableCodemode: null },
    raw,
    parsed: null,
    servers: null,
    autoEnableError: null,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (!isRecord(parsed)) return fail('expected an object with an "mcpServers" object');
  if (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers)) {
    return fail('expected an object with an "mcpServers" object');
  }

  const autoEnableCodemode = typeof parsed.autoEnableCodemode === "boolean" ? parsed.autoEnableCodemode : null;
  const autoEnableError =
    parsed.autoEnableCodemode === undefined || typeof parsed.autoEnableCodemode === "boolean"
      ? null
      : "autoEnableCodemode must be a boolean";
  return {
    file: { scope, path, exists: true, parseError: null, autoEnableError, autoEnableCodemode },
    raw,
    parsed,
    servers: isRecord(parsed.mcpServers) ? parsed.mcpServers : {},
    autoEnableError,
  };
}

export interface ReadMcpPanelOptions extends McpFilePaths {
  projectTrusted: boolean;
}

function validatedGlobalConfigs(servers: Record<string, unknown> | null): Map<string, Record<string, unknown>> {
  const configs = new Map<string, Record<string, unknown>>();
  for (const [name, value] of Object.entries(servers ?? {})) {
    if (!isRecord(value) || isMcpOverride(value)) continue;
    if (typeof validateMcpServerConfig(name, value) !== "string") configs.set(name, value);
  }
  return configs;
}

export function readMcpPanelData(options: ReadMcpPanelOptions): McpPanelData {
  const files = MCP_SCOPES.map((scope) => loadFile(scope, mcpFilePath(scope, options)));
  const errors: string[] = [];
  const entries: McpPanelEntry[] = [];

  const globalConfigs = validatedGlobalConfigs(
    files.find((loaded) => loaded.file.scope === "global")?.servers ?? null,
  );

  for (const loaded of files) {
    if (loaded.file.parseError) errors.push(`${loaded.file.path}: ${loaded.file.parseError}`);
    if (loaded.autoEnableError) errors.push(`${loaded.file.path}: ${loaded.autoEnableError}`);
    for (const [name, value] of Object.entries(loaded.servers ?? {})) {
      let error: string | null = null;
      let override = false;
      if (loaded.file.scope === "project" && isRecord(value) && isMcpOverride(value)) {
        override = true;
        const resolved = resolveMcpOverride(name, value, globalConfigs.get(name));
        error = typeof resolved === "string" ? resolved : null;
      } else {
        const validated = validateMcpServerConfig(name, value);
        error = typeof validated === "string" ? validated : null;
        if (!error && loaded.file.scope === "project" && isRecord(value) && typeof value.url === "string" && value.auth) {
          error = mcpProjectAuthError(name);
        }
      }
      if (error) errors.push(`${loaded.file.path}: ${error}`);
      entries.push({
        name,
        scope: loaded.file.scope,
        rawJson: JSON.stringify(value, null, 2),
        error,
        override,
        shadowsGlobal: false,
        shadowedByProject: false,
      });
    }
  }

  const globalNames = new Set(entries.filter((entry) => entry.scope === "global").map((entry) => entry.name));
  const projectNames = new Set(entries.filter((entry) => entry.scope === "project").map((entry) => entry.name));
  for (const entry of entries) {
    entry.shadowsGlobal = entry.scope === "project" && globalNames.has(entry.name);
    entry.shadowedByProject = entry.scope === "global" && projectNames.has(entry.name);
  }

  return {
    files: files.map((loaded) => loaded.file),
    entries,
    projectTrusted: options.projectTrusted,
    errors,
  };
}

function detectIndent(text: string | null): string {
  return (text && /^([ \t]+)\S/m.exec(text)?.[1]) || "  ";
}

export interface ApplyMcpPanelChangesOptions extends McpFilePaths {
  changes: McpPanelChange[];
}

function validateUpsert(
  scope: McpScope,
  name: string,
  config: Record<string, unknown>,
  globalConfigs: Map<string, Record<string, unknown>>,
): string[] {
  if (scope === "project" && isMcpOverride(config)) {
    const resolved = resolveMcpOverride(name, config, globalConfigs.get(name));
    return typeof resolved === "string" ? [resolved] : [];
  }
  const validated = validateMcpServerConfig(name, config);
  if (typeof validated === "string") return [validated];
  if (scope === "project" && typeof config.url === "string" && config.auth) {
    return [mcpProjectAuthError(name)];
  }
  return [];
}

export function applyMcpPanelChanges(options: ApplyMcpPanelChangesOptions): string[] {
  const errors: string[] = [];
  const targets: { path: string; loaded: LoadedFile; change: McpPanelChange }[] = [];
  const seen = new Set<string>();

  const globalLoaded = loadFile("global", mcpFilePath("global", options));
  const globalConfigs = validatedGlobalConfigs(globalLoaded.servers);

  for (const change of options.changes) {
    if (!MCP_SCOPES.includes(change.scope)) {
      errors.push(`unknown scope "${String(change.scope)}"`);
      continue;
    }
    if (seen.has(change.scope)) {
      errors.push(`scope "${change.scope}" appears twice in one request`);
      continue;
    }
    seen.add(change.scope);

    if (!Array.isArray(change.operations)) {
      errors.push(`scope "${change.scope}" has no operations array`);
      continue;
    }

    for (const operation of change.operations) {
      if (!MCP_SERVER_NAME.test(operation.name)) {
        errors.push(`invalid server name "${operation.name}" (use letters, digits, "_" and "-")`);
        continue;
      }
      if (operation.op === "upsert") {
        errors.push(...validateUpsert(change.scope, operation.name, operation.config, globalConfigs));
      } else if (operation.op !== "remove") {
        errors.push(`unknown operation "${String((operation as { op: unknown }).op)}"`);
      }
    }

    const path = mcpFilePath(change.scope, options);
    const loaded = loadFile(change.scope, path);
    if (loaded.file.parseError) errors.push(`${path}: ${loaded.file.parseError}`);
    targets.push({ path, loaded, change });
  }

  if (errors.length > 0) return errors;

  for (const target of targets) {
    const parsed = target.loaded.parsed ?? {};
    const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
    for (const operation of target.change.operations) {
      if (operation.op === "upsert") servers[operation.name] = pruneMcpDefaults(operation.config);
      else delete servers[operation.name];
    }
    parsed.mcpServers = servers;
    if (target.change.autoEnableCodemode === null) delete parsed.autoEnableCodemode;
    else if (target.change.autoEnableCodemode !== undefined) {
      parsed.autoEnableCodemode = target.change.autoEnableCodemode;
    }

    const next = `${JSON.stringify(parsed, null, detectIndent(target.loaded.raw))}\n`;
    if (next === target.loaded.raw) continue;
    mkdirSync(dirname(target.path), { recursive: true });
    writeFileSync(target.path, next);
  }

  return [];
}
