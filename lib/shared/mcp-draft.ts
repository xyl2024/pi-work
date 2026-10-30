import {
  canonicalMcpJson,
  isMcpOverride,
  MCP_SCOPES,
  MCP_SERVER_NAME,
  mcpOverrideExtraKeys,
  parseMcpEntryConfig,
  pruneMcpDefaults,
  type McpPanelChange,
  type McpPanelData,
  type McpPanelOperation,
  type McpScope,
} from "./mcp-panel";

export interface McpDraftEntry {
  uid: string;
  name: string;
  scope: McpScope;
  rawJson: string;
  config: Record<string, unknown> | null;
  originalName: string | null;
  originalJson: string;
  deleted: boolean;
  loadError: string | null;
  shadowsGlobal: boolean;
  shadowedByProject: boolean;
}

export interface McpDraft {
  entries: McpDraftEntry[];
  autoEnableCodemode: Record<McpScope, boolean>;
}

export type McpDraftProblem =
  | { kind: "invalid-name"; name: string }
  | { kind: "duplicate-name"; scope: McpScope; name: string }
  | { kind: "invalid-json"; name: string }
  | { kind: "not-an-object"; name: string }
  | { kind: "missing-transport"; name: string }
  | { kind: "override-extra-keys"; name: string; keys: string[] };

function fileValue(data: McpPanelData, scope: McpScope): boolean {
  return data.files.find((file) => file.scope === scope)?.autoEnableCodemode ?? true;
}

export function mcpEntryUid(scope: McpScope, name: string, index: number): string {
  return `${scope}:${name}:${index}`;
}

export function draftFromPanelData(data: McpPanelData): McpDraft {
  return {
    entries: data.entries.map((entry, index) => {
      const config = parseMcpEntryConfig(entry.rawJson);
      return {
        uid: mcpEntryUid(entry.scope, entry.name, index),
        name: entry.name,
        scope: entry.scope,
        rawJson: entry.rawJson,
        config,
        originalName: entry.name,
        originalJson: config ? canonicalMcpJson(config) : entry.rawJson.trim(),
        deleted: false,
        loadError: entry.error,
        shadowsGlobal: entry.shadowsGlobal,
        shadowedByProject: entry.shadowedByProject,
      };
    }),
    autoEnableCodemode: {
      global: fileValue(data, "global"),
      project: fileValue(data, "project"),
    },
  };
}

export function addDraftEntry(draft: McpDraft, scope: McpScope): { draft: McpDraft; uid: string } {
  const uid = `new:${draft.entries.length}:${draft.entries.filter((entry) => entry.scope === scope).length}`;
  const rawJson = JSON.stringify({ command: "" }, null, 2);
  return {
    draft: {
      ...draft,
      entries: [
        ...draft.entries,
        {
          uid,
          name: "",
          scope,
          rawJson,
          config: parseMcpEntryConfig(rawJson),
          originalName: null,
          originalJson: "",
          deleted: false,
          loadError: null,
          shadowsGlobal: false,
          shadowedByProject: false,
        },
      ],
    },
    uid,
  };
}

export function addOverrideDraftEntry(draft: McpDraft, name: string): { draft: McpDraft; uid: string } {
  const existing = draft.entries.find(
    (entry) => entry.scope === "project" && entry.name === name && !entry.deleted,
  );
  if (existing) return { draft, uid: existing.uid };

  const config: Record<string, unknown> = { enabled: false };
  const rawJson = JSON.stringify(config, null, 2);
  const uid = `override:${name}`;
  return {
    draft: {
      ...draft,
      entries: [
        ...draft.entries,
        {
          uid,
          name,
          scope: "project",
          rawJson,
          config,
          originalName: null,
          originalJson: "",
          deleted: false,
          loadError: null,
          shadowsGlobal: false,
          shadowedByProject: false,
        },
      ],
    },
    uid,
  };
}

export function withEntryConfig(entry: McpDraftEntry, config: Record<string, unknown>): McpDraftEntry {
  return { ...entry, config, rawJson: JSON.stringify(config, null, 2) };
}

export function withEntryRawJson(entry: McpDraftEntry, rawJson: string): McpDraftEntry {
  return { ...entry, rawJson, config: parseMcpEntryConfig(rawJson) };
}

export function isEntryDirty(entry: McpDraftEntry): boolean {
  if (entry.deleted) return entry.originalName !== null;
  if (entry.originalName === null) return true;
  if (entry.originalName !== entry.name) return true;
  return entry.config ? canonicalMcpJson(entry.config) !== entry.originalJson : entry.rawJson.trim() !== entry.originalJson;
}

function hasTransport(config: Record<string, unknown>): boolean {
  if (typeof config.url === "string" && config.url.length > 0) return true;
  return typeof config.command === "string" && config.command.length > 0;
}

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function wouldWrite(entry: McpDraftEntry): boolean {
  if (entry.deleted) return false;
  if (entry.originalName === null) return true;
  if (entry.originalName !== entry.name) return true;
  return isEntryDirty(entry);
}

export function mcpDraftProblem(draft: McpDraft): McpDraftProblem | null {
  for (const scope of MCP_SCOPES) {
    const live = draft.entries.filter((entry) => !entry.deleted && entry.scope === scope);
    const seen = new Set<string>();
    for (const entry of live) {
      if (seen.has(entry.name)) return { kind: "duplicate-name", scope, name: entry.name };
      seen.add(entry.name);
    }
    for (const entry of live.filter(wouldWrite)) {
      if (!MCP_SERVER_NAME.test(entry.name)) return { kind: "invalid-name", name: entry.name };
      if (!entry.config) return { kind: parsesAsJson(entry.rawJson) ? "not-an-object" : "invalid-json", name: entry.name };
      const config = entry.config;
      if (isMcpOverride(config)) {
        if (entry.scope === "global") return { kind: "missing-transport", name: entry.name };
        const extra = mcpOverrideExtraKeys(config);
        if (extra.length > 0) return { kind: "override-extra-keys", name: entry.name, keys: extra };
        continue;
      }
      if (!hasTransport(config)) return { kind: "missing-transport", name: entry.name };
    }
  }
  return null;
}

export function mcpPendingChanges(draft: McpDraft, data: McpPanelData): McpPanelChange[] {
  const changes: McpPanelChange[] = [];
  for (const scope of MCP_SCOPES) {
    const operations: McpPanelOperation[] = [];
    for (const entry of draft.entries.filter((item) => item.scope === scope)) {
      if (entry.deleted) {
        if (entry.originalName !== null) operations.push({ op: "remove", name: entry.originalName });
        continue;
      }
      if (!entry.config) continue;
      const renamed = entry.originalName !== null && entry.originalName !== entry.name;
      if (renamed) operations.push({ op: "remove", name: entry.originalName! });
      if (entry.originalName === null || renamed || isEntryDirty(entry)) {
        operations.push({ op: "upsert", name: entry.name, config: pruneMcpDefaults(entry.config) });
      }
    }
    const onDisk = fileValue(data, scope);
    const next = draft.autoEnableCodemode[scope];
    const autoEnableCodemode = next === onDisk ? undefined : next ? null : false;
    if (operations.length > 0 || autoEnableCodemode !== undefined) {
      changes.push({
        scope,
        operations,
        ...(autoEnableCodemode === undefined ? {} : { autoEnableCodemode }),
      });
    }
  }
  return changes;
}

export function describeStdioCommands(changes: McpPanelChange[]): string[] {
  const commands: string[] = [];
  for (const change of changes) {
    for (const operation of change.operations) {
      if (operation.op !== "upsert") continue;
      const command = operation.config.command;
      if (typeof command !== "string" || command.length === 0) continue;
      const args = Array.isArray(operation.config.args) ? operation.config.args.filter((arg) => typeof arg === "string") : [];
      commands.push([command, ...args].join(" "));
    }
  }
  return commands;
}

export function describedRemovals(changes: McpPanelChange[]): string[] {
  const names: string[] = [];
  for (const change of changes) {
    for (const operation of change.operations) {
      if (operation.op === "remove") names.push(operation.name);
    }
  }
  return names;
}

export function isDraftDirty(draft: McpDraft, data: McpPanelData): boolean {
  return mcpPendingChanges(draft, data).length > 0;
}
