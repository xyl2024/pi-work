/**
 * Subagent profiles — the user-defined agents `spawn_subagent` can launch.
 *
 * A profile is a row in `subagents.db` (`subagent_profiles`), not a build-time
 * constant: name, description, system prompt, tool set, model, bot appearance
 * and runtime limit are all configurable in Settings → Subagents. The two
 * profiles that used to be hardcoded (`codebase_explorer`, `code_reviewer`)
 * are seeded into the table on first init.
 *
 * Pure types and constants only — no fs, no SQLite, no Node API, no React — so
 * the store, the API route, the tool and the client editor can all share them.
 */

import { CODEGRAPH_TOOL_IDS } from "./codegraph-tool-ids";

/**
 * The CodeGraph tools a default profile gets. `codegraph_build` is excluded:
 * it is gated behind a user confirmation and a child session has no prompt UI
 * (docs/adr/0001). A user *can* add it back through the editor.
 */
export const SUBAGENT_DEFAULT_CODEGRAPH_TOOL_IDS: readonly string[] = CODEGRAPH_TOOL_IDS.filter(
  (id) => id !== "codegraph_build",
);

/**
 * The platform-independent half of a default profile's tool set: the read-only
 * exploration core. Callers compose the shells they know the machine has
 * (`lib/shared/agent-shell-tools.ts` for the server, both shells listed and
 * filtered by the tool picker's catalog for the editor).
 */
export const SUBAGENT_DEFAULT_TOOL_IDS: readonly string[] = [
  "read",
  "grep",
  "ls",
  "find",
  ...SUBAGENT_DEFAULT_CODEGRAPH_TOOL_IDS,
];

/** Thinking levels a subagent session can be started with (mirrors pi's). */
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

/** A subagent's Pi Bot appearance (the shared GrokBot look, no animation flags). */
export interface SubagentBotAppearance {
  /** Index into `GROKBOT_EXPRESSIONS`. */
  expression: number;
  /** Key into `GROKBOT_POOLS` / `GROKBOT_STATE_NAMES`, e.g. "idle". */
  stateKey: string;
  /** Key into `GROKBOT_SHAPES`. */
  shapeId: string;
  /** Enabled body-part ids (hands/feet/tail/antenna). */
  parts: string[];
  /** Enabled accessory ids (straw-hat/glasses/bowtie/cape). */
  accessories: string[];
}

/** Neutral appearance used for new profiles and as the fallback for malformed rows. */
export const DEFAULT_SUBAGENT_BOT: SubagentBotAppearance = {
  expression: 0,
  stateKey: "idle",
  shapeId: "blob",
  parts: [],
  accessories: [],
};

export interface SubagentProfile {
  /** Stable identifier the model passes as `subagent_name`. Unique. */
  name: string;
  /** Shown to the parent model in the spawn_subagent guidelines. */
  description: string;
  systemPrompt: string;
  /** Explicit tool names handed to the child session; `[]` means no tools. */
  tools: string[];
  /** null = inherit the parent session's model. */
  model: { provider: string; modelId: string } | null;
  thinkingLevel: SubagentThinkingLevel;
  bot: SubagentBotAppearance;
  /** Runtime limit in ms; the child is stopped when it exceeds it. */
  timeoutMs: number;
  /** True for the profiles seeded on first init (shown as a badge in the editor). */
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

/** The editor-writable fields of a profile (identity and timestamps are the store's). */
export type SubagentProfileInput = Omit<SubagentProfile, "builtin" | "createdAt" | "updatedAt">;

/** Profile names must be safe to embed in the tool call and in a URL query. */
export const SUBAGENT_NAME_MAX = 64;
export const SUBAGENT_NAME_PATTERN = new RegExp(`^[a-z][a-z0-9_-]{0,${SUBAGENT_NAME_MAX - 1}}$`);

export const SUBAGENT_DESCRIPTION_MAX = 500;
export const SUBAGENT_SYSTEM_PROMPT_MAX = 50_000;
export const SUBAGENT_MAX_TOOLS = 200;

export const DEFAULT_SUBAGENT_TIMEOUT_MS = 15 * 60 * 1000;
export const MIN_SUBAGENT_TIMEOUT_MS = 10 * 1000;
export const MAX_SUBAGENT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** True when `value` is a usable profile name. */
export function isValidSubagentName(value: string): boolean {
  return SUBAGENT_NAME_PATTERN.test(value);
}
