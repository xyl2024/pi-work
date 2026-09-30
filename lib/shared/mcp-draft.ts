/**
 * The MCP panel's draft model: what the user has changed but not yet saved.
 *
 * This is the whole decision surface of the modal, kept as pure functions so it
 * can be driven from `tests/unit` without a browser:
 *
 *   • `draftFromPanelData`  — server state → editable draft.
 *   • `mcpDraftProblem`     — the one blocking problem, or null. Gates "Save".
 *   • `mcpPendingChanges`   — draft vs. disk → the request body.
 *
 * A single entry is one text blob (`rawJson`) plus its parsed form (`config`,
 * null when the blob is not a JSON object). Keeping the text means an entry pi
 * rejects — including one that is not an object at all — can be repaired in
 * place instead of being silently rewritten or dropped.
 */

import {
  canonicalMcpJson,
  MCP_SCOPES,
  MCP_SERVER_NAME,
  parseMcpEntryConfig,
  pruneMcpDefaults,
  type McpPanelChange,
  type McpPanelData,
  type McpPanelOperation,
  type McpScope,
} from "./mcp-panel";

export interface McpDraftEntry {
  /** Stable id, independent of the current name so a rename cannot collide with
   *  another entry (the panel looks entries up by this id while editing). */
  uid: string;
  name: string;
  scope: McpScope;
  /** The entry as text — the raw-JSON editor's value, and what gets written. */
  rawJson: string;
  /** The parsed entry when it is a JSON object (the form's model), else null. */
  config: Record<string, unknown> | null;
  /** The name on disk; null for an entry added in this session. */
  originalName: string | null;
  /** Dirty baseline: canonical JSON of the entry as it was read. */
  originalJson: string;
  /** Marked for deletion — lands only on save. */
  deleted: boolean;
  /** pi's validation error for the entry as read, or null. */
  loadError: string | null;
  shadowsGlobal: boolean;
  shadowedByProject: boolean;
}

export interface McpDraft {
  entries: McpDraftEntry[];
  /** Effective `autoEnableCodemode` per scope (pi's default when the key is absent). */
  autoEnableCodemode: Record<McpScope, boolean>;
}

export type McpDraftProblem =
  | { kind: "invalid-name"; name: string }
  | { kind: "duplicate-name"; scope: McpScope; name: string }
  | { kind: "invalid-json"; name: string }
  | { kind: "not-an-object"; name: string }
  | { kind: "missing-transport"; name: string };

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

/** A new stdio entry, pre-filled with the one thing every server needs. */
export function addDraftEntry(draft: McpDraft, scope: McpScope): { draft: McpDraft; uid: string } {
  const uid = `new:${draft.entries.length}:${draft.entries.filter((entry) => entry.scope === scope).length}`;
  // No `type`: pi infers the transport from `command` vs `url`, and the form
  // drops it on a transport switch — a new entry should look like an edited one.
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

export function updateDraftEntry(draft: McpDraft, uid: string, patch: Partial<McpDraftEntry>): McpDraft {
  return {
    ...draft,
    entries: draft.entries.map((entry) => (entry.uid === uid ? { ...entry, ...patch } : entry)),
  };
}

/** Apply a form edit: the parsed object is the model, its text is derived from it. */
export function withEntryConfig(entry: McpDraftEntry, config: Record<string, unknown>): McpDraftEntry {
  return { ...entry, config, rawJson: JSON.stringify(config, null, 2) };
}

/** Apply a raw-JSON edit; the text is kept even while it is unparsable. */
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

/** Whether saving would write this entry at all (new, renamed, or edited). */
function wouldWrite(entry: McpDraftEntry): boolean {
  if (entry.deleted) return false;
  if (entry.originalName === null) return true;
  if (entry.originalName !== entry.name) return true;
  return isEntryDirty(entry);
}

/**
 * The first problem that must be fixed before saving, or null. The server
 * validates again (it owns the authoritative mirror) — this only keeps the
 * button honest for the mistakes the draft can see on its own.
 *
 * Only entries this save would actually write are checked: an entry pi already
 * skips, and that nobody touched, is left exactly as it is (it is never sent),
 * so it must not block a save of something else.
 */
export function mcpDraftProblem(draft: McpDraft): McpDraftProblem | null {
  for (const scope of MCP_SCOPES) {
    const live = draft.entries.filter((entry) => !entry.deleted && entry.scope === scope);
    // Two entries of one file cannot share a name: writing the second would
    // replace the first without saying so.
    const seen = new Set<string>();
    for (const entry of live) {
      if (seen.has(entry.name)) return { kind: "duplicate-name", scope, name: entry.name };
      seen.add(entry.name);
    }
    for (const entry of live.filter(wouldWrite)) {
      if (!MCP_SERVER_NAME.test(entry.name)) return { kind: "invalid-name", name: entry.name };
      if (!entry.config) return { kind: parsesAsJson(entry.rawJson) ? "not-an-object" : "invalid-json", name: entry.name };
      if (!hasTransport(entry.config)) return { kind: "missing-transport", name: entry.name };
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
      if (!entry.config) continue; // Blocked by mcpDraftProblem; never sent half-parsed.
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

/** The commands the next session will spawn — what the stdio confirmation lists. */
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

/** Names the save will drop from their file. */
export function describedRemovals(changes: McpPanelChange[]): string[] {
  const names: string[] = [];
  for (const change of changes) {
    for (const operation of change.operations) {
      if (operation.op === "remove") names.push(operation.name);
    }
  }
  return names;
}

/** Whether saving would write anything at all. */
export function isDraftDirty(draft: McpDraft, data: McpPanelData): boolean {
  return mcpPendingChanges(draft, data).length > 0;
}
