/**
 * Wire shapes for the MCP panel (client ↔ `/api/mcp`), plus the pure rules
 * both halves need: which server names pi accepts, how an entry is normalized
 * before it is written back, and which exposure names are still current.
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

/**
 * pi's tool-exposure ladder (`McpExposure`). `codemode-deferred` left the
 * ladder in pi 1.1.0: the "not listed in the codemode description" behavior
 * moved into `codemode` itself, so the form no longer offers it.
 */
export const MCP_EXPOSURES = ["codemode", "deferred", "direct", "hidden"] as const;
export type McpExposure = (typeof MCP_EXPOSURES)[number];

/**
 * Exposure names pi still accepts in `mcp.json` but no longer lists, mapped to
 * the name they now stand for. pi resolves them while validating
 * (`MCP_EXPOSURE_ALIASES` in its `mcp-servers` module), so a saved entry and
 * this UI both read back the current name.
 */
export const MCP_EXPOSURE_ALIASES: Readonly<Record<string, string>> = { "codemode-deferred": "codemode" };

/**
 * An entry's exposure with the legacy aliases resolved, defaulting to pi's
 * `codemode`. Unknown values pass through unchanged: the entry is invalid and
 * the panel shows pi's error next to it rather than silently rewriting it.
 */
export function resolveMcpExposure(value: unknown): McpExposure {
  const resolved =
    typeof value === "string" && value !== "" ? (MCP_EXPOSURE_ALIASES[value] ?? value) : "codemode";
  return resolved as McpExposure;
}

/** Server names pi accepts — mirrors `SERVER_NAME` in `lib/server/mcp-config.ts`. */
export const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * The only keys a project entry may set when it has no transport of its own.
 * pi calls such an entry an **override**: it merges these keys into the global
 * server of the same name instead of defining a server. Mirrors pi's
 * `OVERRIDE_KEYS` in `extensions/mcp/config.js`.
 */
export const MCP_OVERRIDE_KEYS = ["enabled", "exposure", "toolExposure"] as const;

/**
 * Whether an entry overrides a global server instead of defining one: it has no
 * `command`, `url`, or `type`. pi's `isOverride`, kept in one place so the
 * loader mirror, the panel reader, and the draft validator cannot drift.
 */
export function isMcpOverride(value: Record<string, unknown>): boolean {
  return value.command === undefined && value.url === undefined && value.type === undefined;
}

/** The keys an override entry sets that pi does not allow. */
export function mcpOverrideExtraKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => !(MCP_OVERRIDE_KEYS as readonly string[]).includes(key));
}

/** pi's message for an override with extra keys — kept verbatim so both halves agree. */
export function mcpOverrideExtraKeysError(name: string): string {
  return `server "${name}": an override can only set ${MCP_OVERRIDE_KEYS.join(", ")}`;
}

/** pi's message for an override with no global server of the same name. */
export function mcpOverrideMissingBaseError(name: string): string {
  return `server "${name}" needs "command" or "url", or a global server to override`;
}

/**
 * pi's message when a project entry tries to use `auth`: a repository must not
 * pick where the credential goes, so the field only exists in the global file.
 */
export function mcpProjectAuthError(name: string): string {
  return `server "${name}": auth is only allowed in the global mcp.json`;
}

/**
 * The keys the entry form models — the required trio (name / transport /
 * command-or-url) plus everything the advanced section exposes. Used to tell
 * the user how many fields the form does not cover (story 16).
 */
export const MCP_FORM_FIELDS = [
  "type",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
  "timeout",
  "exposure",
  "enabled",
  "description",
] as const;

/** The keys present in an entry that the form does not model (`oauth`, `auth`, `toolExposure`, …). */
export function mcpUncoveredFields(config: Record<string, unknown>): string[] {
  return Object.keys(config).filter((key) => !(MCP_FORM_FIELDS as readonly string[]).includes(key));
}

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
  /**
   * A project entry with no transport of its own: it only merges `enabled` /
   * `exposure` / `toolExposure` into the global server of the same name, rather
   * than defining or replacing a server. See `isMcpOverride`.
   */
  override: boolean;
}

/** One `mcp.json`, whether or not it exists yet. */
export interface McpPanelFile {
  scope: McpScope;
  path: string;
  exists: boolean;
  /** File-level failure (JSON syntax, or a top-level shape pi rejects): the panel refuses to save. */
  parseError: string | null;
  /** `autoEnableCodemode` was present but not a boolean: pi logs it and keeps the servers. */
  autoEnableError: string | null;
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
  // An override entry's whole point is the key it sets, even at pi's default
  // value (`enabled: true` re-enables a server the global file disabled), so its
  // shape is never pruned down to `{}` — pi keeps it too.
  if (isMcpOverride(config)) {
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) kept[key] = value;
    }
    return kept;
  }
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

/**
 * One problem the list page reports, attributed to the file or the entry it
 * came from. `level` is the distinction the raw error strings cannot carry:
 *
 *   • `file` — the file is unusable and the panel refuses to save it;
 *   • `entry` — pi skips that server and every other server still connects.
 */
export interface McpProblem {
  scope: McpScope | null;
  level: "file" | "entry";
  /** The entry name for entry-level problems, null otherwise. */
  name: string | null;
  message: string;
}

/**
 * Collapse the panel's three error sources (the loader's `errors[]`, each
 * file's `parseError` / `autoEnableError`, each entry's `error`) into one
 * de-duplicated list. A string in `errors[]` that no structured fact already
 * accounts for still surfaces, so nothing pi said is lost.
 */
export function projectMcpProblems(data: McpPanelData): McpProblem[] {
  const problems: McpProblem[] = [];
  const seen = new Set<string>();
  const push = (problem: McpProblem) => {
    const key = `${problem.scope ?? ""}|${problem.level}|${problem.name ?? ""}|${problem.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push(problem);
  };

  for (const file of data.files) {
    if (file.parseError) push({ scope: file.scope, level: "file", name: null, message: file.parseError });
    if (file.autoEnableError) push({ scope: file.scope, level: "file", name: null, message: file.autoEnableError });
  }
  for (const entry of data.entries) {
    if (entry.error) push({ scope: entry.scope, level: "entry", name: entry.name, message: entry.error });
  }
  for (const error of data.errors) {
    if (problems.some((problem) => error.endsWith(problem.message))) continue;
    push({ scope: null, level: "file", name: null, message: error });
  }
  return problems;
}

/** The summary line's two numbers: files that cannot be saved, invalid entries. */
export interface McpProblemSummary {
  files: number;
  entries: number;
}

export function summarizeMcpProblems(problems: McpProblem[]): McpProblemSummary {
  const files = new Set<McpScope | "">();
  let entries = 0;
  for (const problem of problems) {
    if (problem.level === "file") files.add(problem.scope ?? "");
    else entries += 1;
  }
  return { files: files.size, entries };
}

/**
 * Whether the file-level codemode switch can affect anything here. pi only acts
 * on it for non-`direct` exposure, so a file with only `direct` servers hides
 * the switch instead of offering a control with no visible effect.
 */
export function entryUsesCodemode(config: Record<string, unknown> | null): boolean {
  return config !== null && resolveMcpExposure(config.exposure) !== "direct";
}
