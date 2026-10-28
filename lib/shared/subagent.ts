/**
 * Subagent profiles — the user-defined agents the `subagent` tool's `spawn`
 * action can launch.
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
  /** Shown to the parent model in the subagent tool guidelines. */
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

/**
 * The name of the agent tool that manages subagents. One name, six actions
 * (`spawn`, `list`, `get`, `wait`, `continue`, `cancel`); the previous
 * `spawn_subagent` name is not registered any more — stored tool selections are
 * migrated on load, and old messages stay readable through the display layer.
 */
export const SUBAGENT_TOOL_NAME = "subagent";

/** Legacy tool name, read-only: migrated selections and old message rendering. */
export const LEGACY_SPAWN_SUBAGENT_TOOL_NAME = "spawn_subagent";

/**
 * Default tool-call wait for `spawn` / `continue` (15 minutes). Waiting is an
 * observation only: when it expires the task keeps running and the caller can
 * wait again.
 */
export const DEFAULT_SUBAGENT_WAIT_MS = 15 * 60 * 1000;

/** Upper bound for an explicit wait; 0 means "return immediately". */
export const MAX_SUBAGENT_WAIT_MS = 60 * 60 * 1000;

/**
 * The child configuration resolved when a task is created. Every later turn of
 * the same child session reuses this snapshot, so editing or deleting the
 * profile never reconfigures an existing child, and a cold start restores the
 * same (narrowed) capabilities.
 */
export interface SubagentTaskConfigSnapshot {
  subagentName: string;
  /** Working directory the child session was created in. */
  cwd: string;
  /** Model resolved at creation: the profile's, else the parent's. */
  model: { provider: string; modelId: string };
  thinkingLevel: SubagentThinkingLevel;
  /** Tool set baked into the child session; the subagent tool is never in it. */
  tools: string[];
  /**
   * System prompt contribution resolved at creation. `override` is an inherited
   * prompt copied verbatim; `prefix` is the profile's own prompt.
   */
  systemPrompt: { kind: "override"; text: string } | { kind: "prefix"; text: string };
  /** Runtime limit for each turn of this child; queue time never counts. */
  timeoutMs: number;
}

export const DEFAULT_SUBAGENT_TIMEOUT_MS = 30 * 60 * 1000;
export const MIN_SUBAGENT_TIMEOUT_MS = 10 * 1000;
export const MAX_SUBAGENT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Bounded reads for the `list` / `get` actions
//
// The parent's context window is the scarce resource: a list returns session
// summaries only (never prompts, transcripts or full results), and a detail
// read hands back one explicit window that says how to fetch the next one.
// ============================================================================

/** Default page size for `list` and for a session's task history in `get`. */
export const SUBAGENT_LIST_DEFAULT_LIMIT = 10;
/** Hard cap on one page; larger requests are clamped, not rejected. */
export const SUBAGENT_LIST_MAX_LIMIT = 50;

/** Default character window for a task result in `get`. */
export const SUBAGENT_RESULT_WINDOW_DEFAULT = 4_000;
/** Hard cap on one result window; larger requests are clamped. */
export const SUBAGENT_RESULT_WINDOW_MAX = 20_000;

/** Default number of recent tool calls `get` reports. */
export const SUBAGENT_ACTIVITY_DEFAULT_LIMIT = 20;
/** Hard cap on the activity feed. */
export const SUBAGENT_ACTIVITY_MAX_LIMIT = 50;

/** Default number of transcript messages in `get`; 0 means "don't read it". */
export const SUBAGENT_TRANSCRIPT_DEFAULT_LIMIT = 0;
/** Hard cap on transcript messages per page. */
export const SUBAGENT_TRANSCRIPT_MAX_LIMIT = 20;
/** Per-message character cap inside a transcript page (each note is explicit). */
export const SUBAGENT_TRANSCRIPT_MESSAGE_MAX = 2_000;

/**
 * One bounded slice of a long text, with everything a caller needs to read the
 * next slice. `truncated` covers both ends: a window that started late and a
 * window that ends early. Pure, so the tool, the queries and the tests share
 * exactly one truncation rule.
 */
export interface SubagentTextWindow {
  text: string;
  /** Character offset the window starts at. */
  offset: number;
  /** Requested window size after clamping. */
  limit: number;
  /** Length of the whole text. */
  total: number;
  /** True when the window does not cover the whole text. */
  truncated: boolean;
  /** Characters before the window. */
  skipped: number;
  /** Characters after the window. */
  remaining: number;
  /** Offset to pass next, or null when the window reaches the end. */
  nextOffset: number | null;
}

/** Slice `text` into one window; offsets outside the text are clamped. */
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

/**
 * Map a stored tool selection onto today's tool names: a selection written
 * before the rename may still say `spawn_subagent`, which is no longer
 * registered. Order is preserved, duplicates collapse, and `"all"` is left
 * alone. Pure, so every loader (session sidecar, cwd defaults, scheduler tasks,
 * profiles) migrates by the same rule.
 */
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

/** True when `value` is a usable profile name. */
export function isValidSubagentName(value: string): boolean {
  return SUBAGENT_NAME_PATTERN.test(value);
}
