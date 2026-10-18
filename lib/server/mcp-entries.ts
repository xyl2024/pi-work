import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import {
  isMcpOverride,
  MCP_SCOPES,
  MCP_SERVER_NAME,
  mcpOverrideExtraKeys,
  mcpOverrideExtraKeysError,
  mcpOverrideMissingBaseError,
  pruneMcpDefaults,
  type McpPanelChange,
  type McpPanelData,
  type McpPanelEntry,
  type McpPanelFile,
  type McpScope,
} from "@/lib/shared/mcp-panel";
import { validateMcpServerConfig } from "./mcp-config";

/**
 * The read/write half of the MCP panel: pi's two `mcp.json` files as data the
 * UI can show and change.
 *
 * Why a second reader instead of `loadMcpConfigForPiWork` (lib/server/mcp-config.ts)
 * ────────────────────────────────────────────────────────────────────────────
 * The loader answers "which servers may a session connect" — it drops invalid
 * entries and collapses the two files into one list. The panel has to answer
 * "what is in these files" instead: invalid entries have to be visible (and
 * fixable) rather than absent, and a project entry that is being ignored must
 * still show up next to the global one it would replace.
 *
 * Writing is a read-modify-write on one file at a time: parse, touch only the
 * entries and the `autoEnableCodemode` key this change names, and write the
 * whole object back in the shape pi itself writes (existing indentation,
 * trailing newline). Everything the panel does not understand survives —
 * invalid entries, unknown top-level keys, key order. See ADR-0010.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface McpFilePaths {
  agentDir: string;
  cwd: string;
}

/** Where one scope's `mcp.json` lives. Mirrors the paths the loader reads. */
export function mcpFilePath(scope: McpScope, paths: McpFilePaths): string {
  return scope === "global" ? join(paths.agentDir, "mcp.json") : join(paths.cwd, CONFIG_DIR_NAME, "mcp.json");
}

interface LoadedFile {
  file: McpPanelFile;
  /** The file's text, or null when it does not exist. */
  raw: string | null;
  /** The parsed object, when the file is usable. */
  parsed: Record<string, unknown> | null;
  /** `parsed.mcpServers` when it is an object (empty when absent); null on a shape error. */
  servers: Record<string, unknown> | null;
  /** A present-but-unusable `autoEnableCodemode`: pi logs it and keeps reading the servers. */
  autoEnableError: string | null;
}

function loadFile(scope: McpScope, path: string): LoadedFile {
  const empty: McpPanelFile = { scope, path, exists: false, parseError: null, autoEnableCodemode: null };
  if (!existsSync(path)) {
    return { file: empty, raw: null, parsed: null, servers: null, autoEnableError: null };
  }

  const raw = readFileSync(path, "utf8");
  const fail = (parseError: string): LoadedFile => ({
    file: { scope, path, exists: true, parseError, autoEnableCodemode: null },
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
  return {
    file: { scope, path, exists: true, parseError: null, autoEnableCodemode },
    raw,
    parsed,
    servers: isRecord(parsed.mcpServers) ? parsed.mcpServers : {},
    autoEnableError:
      parsed.autoEnableCodemode === undefined || typeof parsed.autoEnableCodemode === "boolean"
        ? null
        : "autoEnableCodemode must be a boolean",
  };
}

export interface ReadMcpPanelOptions extends McpFilePaths {
  /** Whether the workspace file is trusted at all (`PiWorkConfig.mcp.project_servers`). */
  projectTrusted: boolean;
}

/**
 * Both files plus the merged view the panel shows. Never throws: a broken file
 * becomes a `parseError` (and stays uneditable), a broken entry an entry-level
 * `error` that pi would skip.
 */
export function readMcpPanelData(options: ReadMcpPanelOptions): McpPanelData {
  const files = MCP_SCOPES.map((scope) => loadFile(scope, mcpFilePath(scope, options)));
  const errors: string[] = [];
  const entries: McpPanelEntry[] = [];

  // The validated global servers by name: a project override is validated
  // against the server it amends, exactly as pi's loader does.
  const globalConfigs = new Map<string, Record<string, unknown>>();
  const global = files.find((loaded) => loaded.file.scope === "global");
  for (const [name, value] of Object.entries(global?.servers ?? {})) {
    if (!isRecord(value) || isMcpOverride(value)) continue;
    if (typeof validateMcpServerConfig(name, value) !== "string") globalConfigs.set(name, value);
  }

  for (const loaded of files) {
    if (loaded.file.parseError) errors.push(`${loaded.file.path}: ${loaded.file.parseError}`);
    if (loaded.autoEnableError) errors.push(`${loaded.file.path}: ${loaded.autoEnableError}`);
    for (const [name, value] of Object.entries(loaded.servers ?? {})) {
      let error: string | null = null;
      let override = false;
      if (loaded.file.scope === "project" && isRecord(value) && isMcpOverride(value)) {
        // A transport-less project entry is an override, not an invalid entry:
        // it only sets keys on the global server of the same name.
        override = true;
        const base = globalConfigs.get(name);
        if (base === undefined) {
          error = mcpOverrideMissingBaseError(name);
        } else {
          const extra = mcpOverrideExtraKeys(value);
          if (extra.length > 0) {
            error = mcpOverrideExtraKeysError(name);
          } else {
            const validated = validateMcpServerConfig(name, { ...base, ...value });
            error = typeof validated === "string" ? validated : null;
          }
        }
      } else {
        const validated = validateMcpServerConfig(name, value);
        error = typeof validated === "string" ? validated : null;
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

  // Shadowing is a name-level fact between the two files: pi replaces a global
  // entry with a project entry of the same name, and both stay on disk.
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

/** pi's own rule: keep the indentation the file already uses. */
function detectIndent(text: string | null): string {
  return (text && /^([ \t]+)\S/m.exec(text)?.[1]) || "  ";
}

export interface ApplyMcpPanelChangesOptions extends McpFilePaths {
  changes: McpPanelChange[];
}

/**
 * Validate one upsert. A project entry with no transport is an **override**: its
 * base is the global server of the same name, and it may only set pi's override
 * keys. Anything else is validated as a definition, as before.
 */
function validateUpsert(
  scope: McpScope,
  name: string,
  config: Record<string, unknown>,
  globalConfigs: Map<string, Record<string, unknown>>,
): string[] {
  if (scope === "project" && isMcpOverride(config)) {
    const base = globalConfigs.get(name);
    if (base === undefined) return [mcpOverrideMissingBaseError(name)];
    if (mcpOverrideExtraKeys(config).length > 0) return [mcpOverrideExtraKeysError(name)];
    const validated = validateMcpServerConfig(name, { ...base, ...config });
    return typeof validated === "string" ? [validated] : [];
  }
  const validated = validateMcpServerConfig(name, config);
  return typeof validated === "string" ? [validated] : [];
}

/**
 * Apply the panel's pending changes. Returns the reasons it refused, or an
 * empty list after writing. Nothing is written unless every change validated,
 * so a rejected save can never leave one file updated and the other not.
 */
export function applyMcpPanelChanges(options: ApplyMcpPanelChangesOptions): string[] {
  const errors: string[] = [];
  const targets: { path: string; loaded: LoadedFile; change: McpPanelChange }[] = [];
  const seen = new Set<string>();

  // The global servers by name, so a project override can be validated against
  // the same base the loader uses.
  const globalLoaded = loadFile("global", mcpFilePath("global", options));
  const globalConfigs = new Map<string, Record<string, unknown>>();
  for (const [name, value] of Object.entries(globalLoaded.servers ?? {})) {
    if (!isRecord(value) || isMcpOverride(value)) continue;
    if (typeof validateMcpServerConfig(name, value) !== "string") globalConfigs.set(name, value);
  }

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
    // A file whose JSON does not parse cannot be edited safely: any write would
    // be a rewrite of content we could not read.
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
