import type { BackgroundPermissionMode } from "./permission-mode";

export const SUBAGENT_DEFAULT_TOOL_IDS: readonly string[] = ["read"];

export const SUBAGENT_IMPLEMENTER_TOOL_IDS: readonly string[] = [
  "read",
  "edit",
  "write",
  "bash",
  "codemode",
];

export const SUBAGENT_WEB_SEARCHER_TOOL_IDS: readonly string[] = [
  "web_search",
  "web_fetch",
  "bash",
  "read",
  "write",
  "edit",
];

export const SUBAGENT_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type SubagentThinkingLevel = (typeof SUBAGENT_THINKING_LEVELS)[number];

export interface SubagentBotAppearance {
  expression: number;
  stateKey: string;
  shapeId: string;
  parts: string[];
  accessories: string[];
}

export const DEFAULT_SUBAGENT_BOT: SubagentBotAppearance = {
  expression: 0,
  stateKey: "idle",
  shapeId: "blob",
  parts: [],
  accessories: [],
};

export interface SubagentProfile {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  inheritSystemPrompt: boolean;
  model: { provider: string; modelId: string } | null;
  thinkingLevel: SubagentThinkingLevel;
  permissionMode: BackgroundPermissionMode;
  bot: SubagentBotAppearance;
  timeoutMs: number;
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

export type SubagentProfileInput =
  Omit<SubagentProfile, "builtin" | "createdAt" | "updatedAt" | "inheritSystemPrompt" | "permissionMode"> & {
    inheritSystemPrompt?: boolean;
    permissionMode?: BackgroundPermissionMode;
  };

export type NormalizedSubagentProfileInput =
  Omit<SubagentProfileInput, "inheritSystemPrompt" | "permissionMode"> & {
    inheritSystemPrompt: boolean;
    permissionMode: BackgroundPermissionMode;
  };

export const SUBAGENT_NAME_MAX = 64;
export const SUBAGENT_NAME_PATTERN = new RegExp(`^[a-z][a-z0-9_-]{0,${SUBAGENT_NAME_MAX - 1}}$`);

export const SUBAGENT_DESCRIPTION_MAX = 500;
export const SUBAGENT_SYSTEM_PROMPT_MAX = 50_000;
export const SUBAGENT_MAX_TOOLS = 200;

export const SUBAGENT_TOOL_NAME = "subagent";

export const LEGACY_SPAWN_SUBAGENT_TOOL_NAME = "spawn_subagent";

export const DEFAULT_SUBAGENT_WAIT_MS = 15 * 60 * 1000;

export const MAX_SUBAGENT_WAIT_MS = 60 * 60 * 1000;

export interface SubagentTaskConfigSnapshot {
  subagentName: string;
  cwd: string;
  model: { provider: string; modelId: string };
  thinkingLevel: SubagentThinkingLevel;
  permissionMode: BackgroundPermissionMode;
  tools: string[];
  systemPrompt: { kind: "override"; text: string } | { kind: "prefix"; text: string };
  timeoutMs: number;
}

export const DEFAULT_SUBAGENT_TIMEOUT_MS = 30 * 60 * 1000;
export const MIN_SUBAGENT_TIMEOUT_MS = 10 * 1000;
export const MAX_SUBAGENT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export const SUBAGENT_REQUEST_ID_MAX = 200;

export const SUBAGENT_LIST_DEFAULT_LIMIT = 10;
export const SUBAGENT_LIST_MAX_LIMIT = 50;

export const SUBAGENT_RESULT_WINDOW_DEFAULT = 30_000;
export const SUBAGENT_RESULT_WINDOW_MAX = 30_000;

export const SUBAGENT_ACTIVITY_DEFAULT_LIMIT = 20;
export const SUBAGENT_ACTIVITY_MAX_LIMIT = 50;

export const SUBAGENT_TRANSCRIPT_DEFAULT_LIMIT = 0;
export const SUBAGENT_TRANSCRIPT_MAX_LIMIT = 20;
export const SUBAGENT_TRANSCRIPT_MESSAGE_MAX = 2_000;

export interface SubagentTextWindow {
  text: string;
  offset: number;
  limit: number;
  total: number;
  truncated: boolean;
  skipped: number;
  remaining: number;
  nextOffset: number | null;
}

export function sliceSubagentText(
  text: string,
  offset = 0,
  limit = SUBAGENT_RESULT_WINDOW_DEFAULT,
): SubagentTextWindow {
  const total = text.length;
  const start = Math.min(Math.max(0, Math.trunc(offset) || 0), total);
  const size = Math.max(1, Math.trunc(limit) || SUBAGENT_RESULT_WINDOW_DEFAULT);
  const end = Math.min(total, start + size);
  const slice = text.slice(start, end);
  return {
    text: slice,
    offset: start,
    limit: size,
    total,
    truncated: start > 0 || end < total,
    skipped: start,
    remaining: total - end,
    nextOffset: end < total ? end : null,
  };
}

export function migrateToolName(name: string): string {
  return name === LEGACY_SPAWN_SUBAGENT_TOOL_NAME ? SUBAGENT_TOOL_NAME : name;
}

export function migrateToolNames(names: readonly string[]): string[] {
  const migrated: string[] = [];
  for (const name of names) {
    const next = migrateToolName(name);
    if (!migrated.includes(next)) migrated.push(next);
  }
  return migrated;
}

export function isValidSubagentName(value: string): boolean {
  return SUBAGENT_NAME_PATTERN.test(value);
}
