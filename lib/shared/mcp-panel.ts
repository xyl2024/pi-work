/**
 * Wire shapes for the MCP panel (client ↔ `/api/mcp`), plus the two pure rules
 * both halves need: which server names pi accepts, and how an entry is
 * normalized before it is written back.
 *
 * Browser-safe by construction — no `fs` / `path` / pi SDK here. The pi-owned
 * schema this mirrors is documented at the mirror itself
 * (`lib/server/mcp-config.ts`); the server half that fills these shapes lives in
 * `lib/server/mcp-entries.ts`, the client draft model in `./mcp-draft.ts`.
 */

/** Which `mcp.json` an entry came from — pi's own `scope` field, minus `extension`. */
export type McpScope = "global" | "project";

/** Both scopes in display order: the always-read file first. */
export const MCP_SCOPES: readonly McpScope[] = ["global", "project"];

/** pi's tool-exposure ladder (`McpExposure`). */
export const MCP_EXPOSURES = ["codemode", "codemode-deferred", "deferred", "direct", "hidden"] as const;
export type McpExposure = (typeof MCP_EXPOSURES)[number];

/** Server names pi accepts — mirrors `SERVER_NAME` in `lib/server/mcp-config.ts`. */
export const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/** One server entry as it sits in a file. */
export interface McpPanelEntry {
  name: string;
  scope: McpScope;
  /** The entry's value, pretty-printed — what the raw-JSON editor shows and edits. */
  rawJson: string;
  /** pi's validation error for this entry, or null when it would connect. */
  error: string | null;
  /** A project entry that replaces a global entry of the same name. */
  shadowsGlobal: boolean;
  /** A global entry that a project entry replaces. */
  shadowedByProject: boolean;
}

/** One `mcp.json`, whether or not it exists yet. */
export interface McpPanelFile {
  scope: McpScope;
  path: string;
  exists: boolean;
  /** File-level failure (JSON syntax, or a top-level shape pi rejects): the panel refuses to save. */
  parseError: string | null;
  /** `autoEnableCodemode` as written; null when the key is absent (pi defaults to true). */
  autoEnableCodemode: boolean | null;
}

export interface McpPanelData {
  /** Always both scopes, in `MCP_SCOPES` order. */
  files: McpPanelFile[];
  entries: McpPanelEntry[];
  /** `PiWorkConfig.mcp.project_servers` — whether sessions read the workspace file at all. */
  projectTrusted: boolean;
  /** The loader-level error list: the same text pi logs and notifies with. */
  errors: string[];
}

export type McpPanelOperation =
  | { op: "upsert"; name: string; config: Record<string, unknown> }
  | { op: "remove"; name: string };

/**
 * One file's worth of changes. The server applies every change in one request
 * and validates them all before touching a single file.
 */
export interface McpPanelChange {
  scope: McpScope;
  operations: McpPanelOperation[];
  /**
   * File-level switch. `undefined` leaves the key alone, `null` deletes it
   * (true is pi's default, so that is how "on" is stored).
   */
  autoEnableCodemode?: boolean | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys whose empty form pi treats as "not set". */
const DROP_WHEN_EMPTY = new Set(["args", "env", "headers", "toolExposure"]);

/**
 * Strip the keys pi applies as defaults when they are absent: `enabled: true`,
 * `exposure: "codemode"`, and empty collections. Semantically identical to
 * writing them out, but it keeps the file in the shape the pi CLI / TUI writes
 * and makes "nothing changed" actually mean nothing is written.
 */
export function pruneMcpDefaults(config: Record<string, unknown>): Record<string, unknown> {
  const pruned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;
    if (key === "enabled" && value === true) continue;
    if (key === "exposure" && value === "codemode") continue;
    if (Array.isArray(value) && value.length === 0 && DROP_WHEN_EMPTY.has(key)) continue;
    if (isRecord(value) && Object.keys(value).length === 0 && DROP_WHEN_EMPTY.has(key)) continue;
    pruned[key] = value;
  }
  return pruned;
}

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortedValue(value[key]);
  return sorted;
}

/**
 * Stable text for "did this entry change?" — pruned defaults plus sorted keys,
 * so `{ command, enabled: true }` and `{ enabled: true, command }` are equal.
 */
export function canonicalMcpJson(config: Record<string, unknown>): string {
  return JSON.stringify(sortedValue(pruneMcpDefaults(config)));
}

/** Parse an entry's text into a JSON object, or null when it is anything else. */
export function parseMcpEntryConfig(rawJson: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawJson);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
