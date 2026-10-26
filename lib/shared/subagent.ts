/**
 * Subagent profiles — the user-defined agents `spawn_subagent` can launch.
 *
 * A profile is a row in `subagents.db` (`subagent_profiles`), not a build-time
 * constant: name, description, system prompt, tool set, model, bot appearance
 * and runtime limit are all configurable in Settings → Subagents. The built-ins
 * (`codebase_explorer`, `code_reviewer`, `implementer`) are seeded into the
 * table: all of them on first init, later additions through the seed version.
 *
 * Pure types and constants only — no fs, no SQLite, no Node API, no React — so
 * the store, the API route, the tool and the client editor can all share them.
 */

/**
 * The platform-independent half of a default profile's tool set: `read`, and
 * nothing else. `grep` / `find` / `ls` used to sit beside it; they left the
 * registry with the rest of the search-and-list trio (ADR-0015), so a read-only
 * profile explores with `read` plus the shell of its platform. Callers compose
 * the shells they know the machine has (`lib/shared/agent-shell-tools.ts` for
 * the server, both shells listed and filtered by the tool picker's catalog for
 * the editor).
 */
export const SUBAGENT_DEFAULT_TOOL_IDS: readonly string[] = ["read"];

/**
 * The tool set the built-in `implementer` starts with. Unlike the read-only
 * explorer it is expected to change the working tree, so it gets the editing
 * tools plus a shell and codemode. `bash` is available on every platform
 * (`lib/shared/agent-shell-tools.ts`), so this list is platform-independent.
 */
export const SUBAGENT_IMPLEMENTER_TOOL_IDS: readonly string[] = [
  "read",
  "edit",
  "write",
  "bash",
  "codemode",
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
  /**
   * When true the child starts with a verbatim copy of the parent session's
   * current system prompt; `systemPrompt` is then only the fallback text kept
   * for when the user turns inheritance off.
   */
  inheritSystemPrompt: boolean;
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
export type SubagentProfileInput =
  Omit<SubagentProfile, "builtin" | "createdAt" | "updatedAt" | "inheritSystemPrompt"> & {
    /** Optional for callers written before the flag existed; absent means false. */
    inheritSystemPrompt?: boolean;
  };

/** Input after normalization, where the inherit flag is always resolved. */
export type NormalizedSubagentProfileInput = SubagentProfileInput & { inheritSystemPrompt: boolean };

/** Profile names must be safe to embed in the tool call and in a URL query. */
export const SUBAGENT_NAME_MAX = 64;
export const SUBAGENT_NAME_PATTERN = new RegExp(`^[a-z][a-z0-9_-]{0,${SUBAGENT_NAME_MAX - 1}}$`);

export const SUBAGENT_DESCRIPTION_MAX = 500;
export const SUBAGENT_SYSTEM_PROMPT_MAX = 50_000;
export const SUBAGENT_MAX_TOOLS = 200;

export const DEFAULT_SUBAGENT_TIMEOUT_MS = 30 * 60 * 1000;
export const MIN_SUBAGENT_TIMEOUT_MS = 10 * 1000;
export const MAX_SUBAGENT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** True when `value` is a usable profile name. */
export function isValidSubagentName(value: string): boolean {
  return SUBAGENT_NAME_PATTERN.test(value);
}
