/**
 * The session runtime state: the ONE object holding "what does the client
 * believe this session looks like right now".
 *
 * See `CONTEXT.md` "会话运行时状态（Session runtime state）" and
 * `docs/adr/0007-session-events-are-a-typed-protocol-with-no-default.md`.
 *
 * Before this module the same state was spread over eleven `useState` calls
 * and six refs inside `hooks/useAgentSession/hook.ts`, and one of its dedupe
 * ledgers was a *module-level* `Set` shared across every session. Collecting
 * the whole belief into one object is the precondition for moving the event
 * `switch` into a pure reducer (later slices): until then, a field with two
 * writers — exactly the bug class this refactor exists to remove — is
 * possible.
 *
 * Two properties are worth stating because they are the reason this module
 * lives in the shared layer rather than next to the hook:
 *
 *   • It is pure. No React, no DOM, no Node, no pi SDK — `patchSessionRuntimeState`
 *     takes a state and returns the next one, so the dedupe ledgers can be
 *     asserted directly in `tests/unit` without a browser.
 *   • Ledgers are per-state, not module-level. `createSeenLedger` closes over
 *     its own `Set`, so two `createSessionRuntimeState()` instances can never
 *     see each other's tool-call ids. That is the fix for the cross-session
 *     leak ADR-0003 recorded (`seenCelebrateToolEndIds`).
 */

import type { AgentMessage, SessionTreeNode, ToolResultMessage } from "./types";
import type { ContextComposition } from "./context-composition";
import type { ThinkingLevelOption } from "./thinking-level-utils";

/** Same shape as React's `SetStateAction` — declared locally so the shared
 *  layer stays free of React imports. */
export type StateUpdater<T> = T | ((previous: T) => T);

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_tools"; tools: { id: string; name: string; args?: Record<string, unknown> }[] }
  | { kind: "compacting" }
  | null;

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  errorMessage?: string;
}

/**
 * One tool call that has started but not yet ended.
 *
 * `name` and `args` are recorded on `tool_execution_start` because the
 * `tool_execution_end` event does not carry them: the end event only repeats
 * the tool name, and deciding "did this bash call touch git?" needs the args
 * from the start. `result` is the partial/full tool result accumulated on
 * `tool_execution_update` so long-running calls can render while they run.
 */
export interface InFlightToolCall {
  name: string;
  args: unknown;
  result?: ToolResultMessage;
}

/**
 * A "have I already reacted to this id?" ledger.
 *
 * Deliberately an object with its own storage instead of a bare `Set`: a bare
 * `Set` is what leaked across sessions when it lived at module scope, and a
 * closed-over ledger makes "one ledger per state" the only way to build one.
 */
export interface SeenLedger {
  /** True the first time `id` is claimed, false on every later claim. */
  claim(id: string): boolean;
  has(id: string): boolean;
  clear(): void;
}

export function createSeenLedger(): SeenLedger {
  const seen = new Set<string>();
  return {
    claim(id: string): boolean {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    },
    has(id: string): boolean {
      return seen.has(id);
    },
    clear(): void {
      seen.clear();
    },
  };
}

export interface SessionRuntimeState {
  /** The turn is in flight (streaming, running tools, compacting or retrying). */
  agentRunning: boolean;
  /** Compaction is in flight. Kept for parity with the old write-only state. */
  isCompacting: boolean;
  /** Which step of the turn the client believes we are on. */
  agentPhase: AgentPhase;
  runtimeError: string | null;
  activeLeafId: string | null;
  /** Live conversation tree pushed by the server; null = fall back to disk. */
  liveTree: SessionTreeNode[] | null;
  messages: AgentMessage[];
  /** Tool calls currently in flight, keyed by toolCallId, carrying name + args. */
  inFlightTools: Map<string, InFlightToolCall>;
  /** Bumped to ask the subagent panel to refresh. */
  subagentRefreshKey: number;
  thinkingLevel: ThinkingLevelOption;
  retryInfo: RetryInfo | null;
  contextUsage: ContextUsage | null;
  contextComposition: ContextComposition | null;
  // ── Dedupe ledgers ─────────────────────────────────────────────────────
  // Per-session by construction: each `createSessionRuntimeState()` call makes
  // its own ledgers, so a tool-call id seen in one session can never suppress
  // a refresh in another.
  seenSubagentToolCallIds: SeenLedger;
  seenSubagentToolStartIds: SeenLedger;
  seenSubagentToolEndIds: SeenLedger;
  seenCelebrateToolEndIds: SeenLedger;
  /** The ask-user-questions requests already announced. A request replayed on
   *  SSE reconnect claims an id it already claimed, so it neither re-rings nor
   *  re-opens the card. Seeded from the module store on mount so a remount
   *  while a question is pending does not ring again either. */
  seenAskUserQuestionsToolCallIds: SeenLedger;
  /** A brand-new session is waiting for its first assistant message: the
   *  sidebar can only be refreshed once that message is persisted, and the
   *  callback must fire exactly once even if a replayed `message_end`
   *  arrives. Read *and* cleared by the event reducer, so it belongs in the
   *  state rather than in an adapter ref. */
  awaitingFirstAssistant: boolean;
}

/**
 * A fresh runtime state for one session. Every call gets its own ledgers and
 * its own in-flight tool table — that isolation is the point.
 */
export function createSessionRuntimeState(
  overrides: Partial<SessionRuntimeState> = {},
): SessionRuntimeState {
  return {
    agentRunning: false,
    isCompacting: false,
    agentPhase: null,
    runtimeError: null,
    activeLeafId: null,
    liveTree: null,
    messages: [],
    inFlightTools: new Map(),
    subagentRefreshKey: 0,
    thinkingLevel: "off",
    retryInfo: null,
    contextUsage: null,
    contextComposition: null,
    seenSubagentToolCallIds: createSeenLedger(),
    seenSubagentToolStartIds: createSeenLedger(),
    seenSubagentToolEndIds: createSeenLedger(),
    seenCelebrateToolEndIds: createSeenLedger(),
    seenAskUserQuestionsToolCallIds: createSeenLedger(),
    awaitingFirstAssistant: false,
    ...overrides,
  };
}

/**
 * Resolve one field of the runtime state, returning the *same* object when the
 * field is unchanged. The identity check is what keeps "no-op writes do not
 * re-render" — several event branches (a duplicate `message_end`, an
 * `ask_user_questions_request` replay) resolve to an unchanged field.
 */
export function patchSessionRuntimeState<K extends keyof SessionRuntimeState>(
  state: SessionRuntimeState,
  key: K,
  value: StateUpdater<SessionRuntimeState[K]>,
): SessionRuntimeState {
  const resolved = typeof value === "function"
    ? (value as (previous: SessionRuntimeState[K]) => SessionRuntimeState[K])(state[key])
    : value;
  if (Object.is(resolved, state[key])) return state;
  return { ...state, [key]: resolved };
}

/**
 * Record a tool call as in flight.
 *
 * `name`/`args` are (re)written on every call — a replayed
 * `tool_execution_start` carries the same values, and the old scratchpads
 * wrote unconditionally too. The accumulated partial `result` is preserved
 * when the call is already in flight, so a replayed start cannot wipe output
 * that already streamed in.
 *
 * The placeholder result carries no `timestamp`: this runs inside the pure
 * event reduction, and nothing reads a partial's timestamp. Stamping
 * `Date.now()` here would put a clock read on the reducer's path for a value
 * that is never rendered.
 */
export function upsertInFlightTool(
  inFlightTools: ReadonlyMap<string, InFlightToolCall>,
  id: string,
  name: string,
  args: unknown,
): Map<string, InFlightToolCall> {
  const existing = inFlightTools.get(id);
  const next = new Map(inFlightTools);
  next.set(id, {
    name,
    args,
    result: existing?.result ?? {
      role: "toolResult",
      toolCallId: id,
      toolName: name,
      content: [],
    },
  });
  return next;
}

/**
 * Merge a streamed partial result into an in-flight tool call.
 *
 * Returns `null` when the call is not in flight, so the caller can leave the
 * state untouched rather than fabricating an entry out of an update for a call
 * it never saw start. The `patch` replaces the accumulated content when it
 * carries any and merges `details` alongside it — pi re-sends the whole
 * partial snapshot, so "merge" here means "take the newest observation".
 */
export function mergeInFlightToolPartialResult(
  inFlightTools: ReadonlyMap<string, InFlightToolCall>,
  id: string,
  patch: { content?: ToolResultMessage["content"]; details?: unknown },
): Map<string, InFlightToolCall> | null {
  const existing = inFlightTools.get(id);
  if (!existing) return null;
  const next = new Map(inFlightTools);
  next.set(id, {
    ...existing,
    result: { ...existing.result, ...patch } as ToolResultMessage,
  });
  return next;
}

/** Drop a tool call once it ends. Returns the same map when it was not in
 *  flight (deleting a missing key is a no-op), so a stray end event cannot
 *  churn consumers. */
export function removeInFlightTool(
  inFlightTools: Map<string, InFlightToolCall>,
  id: string,
): Map<string, InFlightToolCall> {
  if (!inFlightTools.has(id)) return inFlightTools;
  const next = new Map(inFlightTools);
  next.delete(id);
  return next;
}

/**
 * The in-flight partial tool results, keyed by toolCallId — the view the chat
 * (and BTW) renders. Derived from `inFlightTools` so there is a single table
 * of in-flight calls; entries only appear once a result exists.
 */
export function inFlightToolResultsOf(
  inFlightTools: ReadonlyMap<string, InFlightToolCall>,
): Map<string, ToolResultMessage> {
  const out = new Map<string, ToolResultMessage>();
  for (const [id, call] of inFlightTools) {
    if (call.result) out.set(id, call.result);
  }
  return out;
}

