export type McpPage = { kind: "list" } | { kind: "entry"; uid: string };

export type McpScope = "global" | "project";

export const MCP_SCOPES: readonly McpScope[] = ["global", "project"];

export const MCP_EXPOSURES = ["codemode", "deferred", "direct", "hidden"] as const;
export type McpExposure = (typeof MCP_EXPOSURES)[number];

export const MCP_EXPOSURE_ALIASES: Readonly<Record<string, string>> = { "codemode-deferred": "codemode" };

export function resolveMcpExposure(value: unknown): McpExposure {
  const resolved =
    typeof value === "string" && value !== "" ? (MCP_EXPOSURE_ALIASES[value] ?? value) : "codemode";
  return resolved as McpExposure;
}

export const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/;

export const MCP_OVERRIDE_KEYS = ["enabled", "exposure", "toolExposure"] as const;

export function isMcpOverride(value: Record<string, unknown>): boolean {
  return value.command === undefined && value.url === undefined && value.type === undefined;
}

export function mcpOverrideExtraKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => !(MCP_OVERRIDE_KEYS as readonly string[]).includes(key));
}

export function mcpOverrideExtraKeysError(name: string): string {
  return `server "${name}": an override can only set ${MCP_OVERRIDE_KEYS.join(", ")}`;
}

export function mcpOverrideMissingBaseError(name: string): string {
  return `server "${name}" needs "command" or "url", or a global server to override`;
}

export function mcpProjectAuthError(name: string): string {
  return `server "${name}": auth is only allowed in the global mcp.json`;
}

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

export function mcpUncoveredFields(config: Record<string, unknown>): string[] {
  return Object.keys(config).filter((key) => !(MCP_FORM_FIELDS as readonly string[]).includes(key));
}

export interface McpPanelEntry {
  name: string;
  scope: McpScope;
  rawJson: string;
  error: string | null;
  shadowsGlobal: boolean;
  shadowedByProject: boolean;
  override: boolean;
}

export interface McpPanelFile {
  scope: McpScope;
  path: string;
  exists: boolean;
  parseError: string | null;
  autoEnableError: string | null;
  autoEnableCodemode: boolean | null;
}

export interface McpPanelData {
  files: McpPanelFile[];
  entries: McpPanelEntry[];
  projectTrusted: boolean;
  errors: string[];
}

export type McpPanelOperation =
  | { op: "upsert"; name: string; config: Record<string, unknown> }
  | { op: "remove"; name: string };

export interface McpPanelChange {
  scope: McpScope;
  operations: McpPanelOperation[];
  autoEnableCodemode?: boolean | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DROP_WHEN_EMPTY = new Set(["args", "env", "headers", "toolExposure"]);

export function pruneMcpDefaults(config: Record<string, unknown>): Record<string, unknown> {
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

export function canonicalMcpJson(config: Record<string, unknown>): string {
  return JSON.stringify(sortedValue(pruneMcpDefaults(config)));
}

export function parseMcpEntryConfig(rawJson: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawJson);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface McpProblem {
  scope: McpScope | null;
  level: "file" | "entry";
  name: string | null;
  message: string;
}

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

export function entryUsesCodemode(config: Record<string, unknown> | null): boolean {
  return config !== null && resolveMcpExposure(config.exposure) !== "direct";
}
