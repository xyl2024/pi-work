/**
 * The session-event protocol: the ONE declaration of what the server can push
 * a client over the agent SSE stream.
 *
 * See `docs/adr/0007-session-events-are-a-typed-protocol-with-no-default.md`.
 * Two halves live here on purpose — the vocabulary (what an event looks like)
 * and the disposition lists (what the client does with it) are the two faces
 * of the same interface:
 *
 *   • `SessionEvent` — the vocabulary. 28 event types: 23 forwarded verbatim
 *     from the pi SDK session, 4 synthesised by `AgentSessionWrapper`
 *     (`session_tree_update`, `permission_request`,
 *     `ask_user_questions_request`, `prompt_failed`) and 1 the SSE route
 *     reports itself (`connected`). The pi SDK's own `AgentSessionEvent` is
 *     deliberately NOT reused: it lacks our 5, and an SDK upgrade would then
 *     silently rewrite this project's protocol. The server-side binding to it
 *     is a static assertion in `lib/server/pi-types.ts`.
 *   • `REDUCED_SESSION_EVENTS` / `IGNORED_SESSION_EVENTS` — every event has to
 *     appear in exactly one of them. The pair is complete *by construction*:
 *     `IgnoredSessionEventType` is the protocol minus the reduced types, and
 *     both records are keyed by their set, so a server-side or SDK event the
 *     client has no opinion about is a **compile error**, not a silent
 *     passthrough.
 *
 * There is no `default:` fallback anywhere in this protocol, and there will be
 * none in the reducer either: an unknown event must fail to compile instead of
 * being swallowed.
 *
 * The second half of the module is the reducer itself, `reduceSessionEvent`.
 * It is pure — no React, no DOM, no timers, no `fetch`, no store writes — and
 * returns the side effects it decided on as data for the client adapter to
 * perform. This module lives in the shared layer, so it must stay free of
 * React, DOM, Node and pi SDK imports.
 */

import type { AskUserQuestion, AskUserQuestionsRequestPayload } from "./ask-user-questions-tool-types";
import { CELEBRATE_TOOL_NAME, type CelebrateDetails } from "./celebrate-tool-types";
import type { UiSoundEventId } from "./config-types";
import { normalizeToolCalls } from "./normalize";
import {
  mergeInFlightToolPartialResult,
  patchSessionRuntimeState,
  removeInFlightTool,
  upsertInFlightTool,
  type SessionRuntimeState,
} from "./session-runtime-state";
import { isShowFileToolName, type ShowFileEntry } from "./show-file-tool-types";
import type { ToolCallReport } from "./tool-call-stats-types";
import type { AgentMessage, AssistantMessage, SessionTreeNode } from "./types";

/** Why pi decided to compact the context. */
export type SessionCompactionReason = "manual" | "threshold" | "overflow";

/**
 * The message payload carried by the message-scoped events
 * (`message_start`, `message_update`, `message_end`, `turn_end`,
 * `agent_end`).
 *
 * It states only what every carrier agrees on. The shared layer cannot import
 * pi's message union (hard layer ban), and the normalised shape the UI renders
 * (`AgentMessage`) is a *different* shape — `normalizeToolCalls` exists
 * precisely to translate pi's `{id,name,arguments}` tool-call blocks into the
 * `{toolCallId,toolName,input}` blocks the viewer expects. A reader narrows
 * from here to whatever it actually needs.
 */
export interface SessionEventMessage {
  role?: string;
  content?: unknown;
  stopReason?: string;
  errorMessage?: string;
  timestamp?: number;
}

/**
 * Every event the agent SSE stream can deliver, with the payload shape the
 * reader may rely on. Single declaration — client and server share it.
 */
export type SessionEvent =
  // ── Forwarded verbatim from the pi SDK session ─────────────────────────
  | { type: "agent_start" }
  | { type: "agent_end"; messages: SessionEventMessage[]; willRetry: boolean }
  | { type: "turn_start" }
  | { type: "turn_end"; message: SessionEventMessage; toolResults: SessionEventMessage[] }
  | { type: "message_start"; message: SessionEventMessage }
  | {
      type: "message_update";
      message: SessionEventMessage;
      /** pi's streaming delta for this token (thinking/text/tool-call chunks).
       *  The client reads the whole `message` snapshot instead, so this stays
       *  untyped rather than mirroring pi's event union. */
      assistantMessageEvent?: unknown;
    }
  | { type: "message_end"; message: SessionEventMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | { type: "agent_settled" }
  | { type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }
  | { type: "compaction_start"; reason: SessionCompactionReason }
  | {
      type: "compaction_end";
      reason: SessionCompactionReason;
      /** pi's compaction result; only pi's own reader consumes it. */
      result: unknown;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | {
      type: "entry_appended";
      /** The persisted `SessionEntry`. pi's entry union is not importable here
       *  and its message payloads differ from the shared mirror, so the
       *  protocol states the event, not the entry. */
      entry: unknown;
    }
  | { type: "session_info_changed"; name: string | undefined }
  | { type: "thinking_level_changed"; level: string }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
  | {
      type: "summarization_retry_scheduled";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | {
      /** pi splits this one into `branchSummary` (no `reason`) and
       *  `compaction` (with `reason`); the protocol states the union once. */
      type: "summarization_retry_attempt_start";
      source: "branchSummary" | "compaction";
      reason?: SessionCompactionReason;
    }
  | { type: "summarization_retry_finished" }
  | { type: "bash_execution_update"; id?: string; delta: string }
  // ── Synthesised by AgentSessionWrapper ────────────────────────────────
  | {
      type: "session_tree_update";
      /** The session tree after the update. pi's tree is not nameable in this
       *  layer (same reason as `entry_appended`); the client narrows it to
       *  `SessionTreeNode[]`. */
      tree: unknown;
      leafId: string | null;
    }
  | { type: "permission_request"; toolCallId: string; ruleName: string; command: string }
  | ({ type: "ask_user_questions_request" } & AskUserQuestionsRequestPayload)
  | { type: "prompt_failed"; error: string }
  // ── Reported by the SSE route itself ──────────────────────────────────
  | { type: "connected"; sessionId: string };

/** The discriminant of the protocol: the set of all 28 event type names. */
export type SessionEventType = SessionEvent["type"];

/**
 * Events the client reduces into the session runtime state.
 *
 * Every key must be a branch of the reducer (reduced in #60–#64); the note says
 * which part of the runtime state the branch owns. Keyed by this union, so a
 * missing entry — and a key the protocol does not have — is a compile error.
 */
export type ReducedSessionEventType =
  | "agent_start"
  | "agent_end"
  | "message_start"
  | "message_update"
  | "message_end"
  | "session_tree_update"
  | "tool_execution_start"
  | "tool_execution_update"
  | "tool_execution_end"
  | "auto_retry_start"
  | "auto_retry_end"
  | "prompt_failed"
  | "permission_request"
  | "ask_user_questions_request"
  | "compaction_start"
  | "compaction_end"
  | "thinking_level_changed";

/**
 * Events the client knows about and deliberately does not act on.
 *
 * Derived as "the protocol minus the reduced set", so a newly added event type
 * lands here by construction and must be given a note (or move to the reduced
 * list) before the client compiles again.
 */
export type IgnoredSessionEventType = Exclude<SessionEventType, ReducedSessionEventType>;

/**
 * The branches the reducer owns. The note is documentation for readers ("what
 * does this event move?") — it is never rendered and never translated.
 */
export const REDUCED_SESSION_EVENTS: Record<ReducedSessionEventType, string> = {
  agent_start: "Clears the runtime error, marks the session running, opens the streaming view.",
  agent_end: "Closes the low-level run: running flags off, pending model error surfaced.",
  message_start: "Opens the streaming view, and refreshes the subagent panel for a new spawn_subagent call.",
  message_update: "Feeds a streamed token snapshot into the streaming view.",
  message_end: "Commits the finished message, records a model error, requests a context-usage refresh.",
  session_tree_update: "Replaces the live conversation tree and the active leaf.",
  tool_execution_start: "Adds an in-flight tool call (name + args), reports it to the tool-call stats, and refreshes the subagent panel for a spawning call.",
  tool_execution_update: "Merges a partial tool result into the in-flight tool call.",
  tool_execution_end: "Retires the in-flight tool call; the args recorded at start decide git invalidation and the result drives the celebration, the file preview and the stats.",
  auto_retry_start: "Shows the auto-retry counter.",
  auto_retry_end: "Clears the retry counter, or surfaces the final error.",
  prompt_failed: "Closes the turn with an error and drops the event stream.",
  permission_request: "Hands the dangerous-command confirmation to the permission queue.",
  ask_user_questions_request: "Opens the question card (once per tool call id) and rings.",
  compaction_start: "Marks the session as compacting.",
  compaction_end: "Leaves compaction, honouring the willRetry branch, and reloads the session.",
  thinking_level_changed: "Mirrors the model's thinking level.",
};

/**
 * Events the client sees and intentionally ignores. Writing the omission down
 * is the point: without it these would silently pass through instead.
 */
export const IGNORED_SESSION_EVENTS: Record<IgnoredSessionEventType, string> = {
  agent_settled:
    "The overall run settled. The client still ends the turn on agent_end (ADR-0004 wants this revisited); listed here so the difference is a decision, not an oversight.",
  turn_start: "Low-level turn boundary; no part of the UI keys off it.",
  turn_end: "Same boundary on the other side; per-turn tool results arrive through message_end.",
  entry_appended: "A session entry was persisted; the tree arrives via session_tree_update instead.",
  queue_update: "Steering / follow-up queue depths; the UI has no queue indicator yet.",
  session_info_changed: "Renames are mirrored to the sidecar server-side and read back through the session APIs.",
  summarization_retry_scheduled: "Compaction-retry telemetry; the banner follows compaction_start / compaction_end.",
  summarization_retry_attempt_start: "Same telemetry, attempt boundary.",
  summarization_retry_finished: "Same telemetry, finished.",
  bash_execution_update: "Streamed bash output; the terminal surface is its own WebSocket, not this stream.",
  connected: "The route's opening frame; the transport already knows which session it subscribed to.",
};

/**
 * Every protocol type name, enumerable at runtime and in declaration order.
 * `satisfies` rejects a name the protocol does not have; the assertion below
 * rejects a type the list is missing.
 */
export const SESSION_EVENT_TYPES = [
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "agent_settled",
  "queue_update",
  "compaction_start",
  "compaction_end",
  "entry_appended",
  "session_info_changed",
  "thinking_level_changed",
  "auto_retry_start",
  "auto_retry_end",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
  "bash_execution_update",
  "session_tree_update",
  "permission_request",
  "ask_user_questions_request",
  "prompt_failed",
  "connected",
] as const satisfies readonly SessionEventType[];

type AssertTrue<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Compile-time proof that the two lists together cover the protocol: no event
 *  type can exist without landing in one of them. It holds by construction
 *  while `IgnoredSessionEventType` is the `Exclude` above — the assertion is
 *  what keeps that true if the derivation is ever replaced by a hand-written
 *  union. */
export type SessionEventDispositionsAreComplete = AssertTrue<
  Equal<SessionEventType, ReducedSessionEventType | IgnoredSessionEventType>
>;

/** Compile-time proof that the reduced list stays inside the protocol. A key
 *  the protocol does not have would otherwise sit in the reduced list forever. */
export type ReducedSessionEventsAreProtocolTypes = AssertTrue<
  ReducedSessionEventType extends SessionEventType ? true : false
>;

/** Compile-time proof that the runtime list above is exactly the protocol:
 *  adding an event to `SessionEvent` without listing it is a type error here,
 *  and so is listing a type the union does not have. */
export type SessionEventTypesAreComplete = AssertTrue<
  Equal<SessionEventType, (typeof SESSION_EVENT_TYPES)[number]>
>;

// ── The reducer ──────────────────────────────────────────────────────────
//
// `(state, event) → { state, effects }`, pure: no React, no DOM, no timers,
// no `fetch`, no toast, no store writes, no logging. Everything the client
// adapter would otherwise do inline comes back as data in `effects`, and the
// adapter is the only thing that performs it.
//
// The port is complete (#60–#63): every reduced event has a branch here, the
// switch has no `default:`, and the ignored half of the protocol is handled by
// the total wrapper below rather than by an adapter-side guard.
//
// Replay: on SSE reconnect the route re-delivers only `session_tree_update`
// and any pending `ask_user_questions_request`, never a turn-boundary event
// (`app/api/agent/[id]/events/route.ts`). The idempotency those two carry is
// therefore not a property this group needs — but no branch below churns the
// state gratuitously either.

/** The reduced half of the protocol, as protocol members. */
export type ReducedSessionEvent = Extract<SessionEvent, { type: ReducedSessionEventType }>;

/** The reduced type names, derived from the disposition record so the two can
 *  never drift — the record is the declaration, this is its runtime index. */
const REDUCED_SESSION_EVENT_TYPE_SET: ReadonlySet<string> = new Set(Object.keys(REDUCED_SESSION_EVENTS));

/**
 * Whether the reducer has an opinion about this event.
 *
 * The protocol partitions by construction — every type is either in
 * `REDUCED_SESSION_EVENTS` or in `IGNORED_SESSION_EVENTS` (the `Exclude`) — so
 * asking the reduced record is the same question as "is this one of the
 * deliberately-ignored ones?". A `Set` derived from the record rather than an
 * `in` check keeps `Object.prototype` keys (`constructor`…) out of the answer.
 */
export function isReducedSessionEvent(event: SessionEvent): event is ReducedSessionEvent {
  return REDUCED_SESSION_EVENT_TYPE_SET.has(event.type);
}

/**
 * A side effect the reducer decided on, as data. The adapter knows how to
 * perform each kind; the reducer knows none of them. Keeping this a closed
 * union is what makes "does a replayed event ring twice?" assertable in a
 * unit test instead of only audible in a browser.
 */
export type SessionEventEffect =
  | { kind: "enqueue_permission_request"; toolCallId: string; ruleName: string; command: string }
  | { kind: "set_pending_ask_user_questions"; request: AskUserQuestionsRequestPayload }
  | { kind: "play_ui_sound"; sound: UiSoundEventId }
  /** Feed the tool-call statistics store. The report carries no `timestamp`:
   *  the adapter stamps `Date.now()` when it performs it. */
  | { kind: "report_tool_call_stats"; report: ToolCallReport }
  /** The worktree's git status may have changed. The adapter knows the
   *  session's cwd; the reducer only decides that a mutation happened (and
   *  whether it was a git-level one that must bypass the server's cache). */
  | { kind: "invalidate_git_status"; force: boolean }
  /** Publish a `show_media` result so the Session Library can render it. */
  | { kind: "show_file_result"; toolCallId: string; files: ShowFileEntry[] }
  /** Play one celebration animation. `details` is passed through verbatim;
   *  the overlay ignores an absent one. */
  | { kind: "celebrate"; details: CelebrateDetails | undefined }
  /** Ask the subagent panel to refresh — now, and (in the adapter) once more
   *  after a delay, so a long-running child eventually shows its result. */
  | { kind: "refresh_subagent_panel"; toolCallId: string }
  /** Flash a state on the sidebar Pi Bot (it reverts to its baseline itself). */
  | { kind: "flash_bot_state"; stateKey: string }
  /** Publish the newest snapshot of the in-flight assistant message to the
   *  live streaming view (its own store — per-token updates must re-render
   *  only the streaming bubble, not the whole chat tree). */
  | { kind: "stream_message"; message: AgentMessage }
  /** Close the live streaming view for a message that just settled.
   *  `message` is the final snapshot to flush, or `null` when nothing was
   *  streaming (a user message); `keepForError` keeps a failed assistant
   *  snapshot mounted so a retryable error does not blank the view. */
  | { kind: "settle_stream"; message: AgentMessage | null; keepForError: boolean }
  /** Ask for a fresh context usage / composition estimate. The reducer never
   *  issues the request itself; the adapter does, at the same moment the old
   *  inline `fetch` ran (a finished assistant message). */
  | { kind: "refresh_context_usage" }
  /** The brand-new session's first assistant message landed: the session file
   *  now exists, so the sidebar can be refreshed. Fires at most once — the
   *  reducer clears `awaitingFirstAssistant` on the way out. */
  | { kind: "first_assistant_ready" }
  /** What the end of the turn (#63) reads off the assistant message that just
   *  settled: whether it was a plain body answer, and the model error to
   *  surface at `agent_end` (`null` = none). The adapter records the two onto
   *  the runtime state, where the turn-end branches read them. */
  | { kind: "record_assistant_outcome"; isBody: boolean; pendingError: string | null }
  /** Open the live streaming view for a new turn, before the first token. */
  | { kind: "begin_stream" }
  /** Clear the per-turn tool-call statistics. */
  | { kind: "reset_tool_call_stats" }
  /** Re-fetch the session's system prompt (a new turn may have changed it). */
  | { kind: "refresh_system_prompt" }
  /** Return the sidebar Pi Bot to its baseline, cancelling a pending flash. */
  | { kind: "set_bot_baseline" }
  /** Show an error toast. The adapter gates it on the session being the
   *  visible tab, so a background tab cannot cover the foreground content. */
  | { kind: "show_error_toast"; message: string }
  /** The end of a compaction reported an error. Kept apart from
   *  `show_error_toast` because the adapter suppresses it while a manual
   *  compaction the user started is still in flight — that path reports its
   *  own failure. */
  | { kind: "show_compaction_error_toast"; message: string }
  /** Re-read the session from disk after the turn ended, resync the runtime
   *  state, then stop watching if nothing is running. A composite on purpose:
   *  the steps are ordered and asynchronous, and "is anything running?" has to
   *  be asked *after* the reload. `close_events` when there is no session. */
  | { kind: "reload_session_after_turn" }
  /** The same resync at the end of a compaction. An `aborted` compaction is
   *  not re-read (pi never wrote the entry). */
  | { kind: "reload_session_after_compaction"; aborted: boolean }
  /** Tell the host the turn ended (it owns the sidebar / notify refresh). */
  | { kind: "notify_agent_end" }
  /** Drop the event stream. */
  | { kind: "close_events" };

/** What one event does to the runtime state, and the effects it asks for. */
export interface SessionEventReduction {
  state: SessionRuntimeState;
  effects: SessionEventEffect[];
}

/** Tools whose execution edits the worktree. `bash` is handled separately
 *  below, because only its arguments reveal whether the command touched git. */
const WORKTREE_MUTATING_TOOL_NAMES = new Set(["edit", "write"]);

/** The Pi Bot reaction to a failed tool call. */
const TOOL_ERROR_BOT_STATE = "suspicious";

/** The error text the end of the turn toasts when pi reports a failed model
 *  call without a message of its own. */
const FALLBACK_ASSISTANT_ERROR = "Model call failed";

/**
 * The `spawn_subagent` tool-call ids inside a message.
 *
 * Read from the raw pi message shape (`{ type: "toolCall", toolName }`), before
 * normalization: this is how the subagent panel learns a child was spawned
 * without waiting for the whole turn to finish.
 */
function spawnSubagentToolCallIdsOf(message: unknown): string[] {
  if (!message || typeof message !== "object") return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const value = block as { type?: unknown; toolName?: unknown; toolCallId?: unknown };
    return value.type === "toolCall" && value.toolName === "spawn_subagent" && typeof value.toolCallId === "string"
      ? [value.toolCallId]
      : [];
  });
}

/**
 * Claim the `spawn_subagent` ids announced by one message, asking for a panel
 * refresh the first time each id is seen and staying silent on the replays
 * that every later token (or an SSE reconnect) brings.
 */
function pushSubagentRefreshes(
  state: SessionRuntimeState,
  message: unknown,
  effects: SessionEventEffect[],
): void {
  for (const toolCallId of spawnSubagentToolCallIdsOf(message)) {
    if (state.seenSubagentToolCallIds.claim(toolCallId)) {
      effects.push({ kind: "refresh_subagent_panel", toolCallId });
    }
  }
}

/** A plain object argument bag, or `undefined` for anything else (`null`,
 *  arrays, scalars) — the shape the tool-call stats store and the phase chip
 *  accept. */
function asArgumentRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Whether `candidate` is already in the committed message list.
 *
 * The comparison is structural (plus role and, for tool results, the
 * tool-call id) because a replayed `message_end` — SSE reconnect or a
 * compaction replay — delivers an equal but not identical object, and the
 * same assistant message must not be queued twice.
 */
function sameCompletedMessage(a: AgentMessage, b: AgentMessage): boolean {
  if (a.role !== b.role) return false;
  if (a.role === "toolResult" && b.role === "toolResult" && a.toolCallId !== b.toolCallId) return false;
  const aTimestamp = "timestamp" in a ? a.timestamp : undefined;
  const bTimestamp = "timestamp" in b ? b.timestamp : undefined;
  if (aTimestamp !== undefined && bTimestamp !== undefined && aTimestamp !== bTimestamp) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Whether an assistant message is a plain body answer: non-empty text and not
 * a failed model call. The end of the turn reads this to pick the sidebar Pi
 * Bot reaction (`happy` for a body answer, `waking` otherwise).
 *
 * NOTE (ported verbatim in #62): the tool-call half of the check looks for a
 * `toolUse` block, a type neither pi nor this project emits (both use
 * `toolCall`), so in practice this is "has text and is not an error". The
 * check is left untouched to keep the port behaviour-frozen; the drift is a
 * finding for a follow-up slice, not something this move may fix.
 */
function isBodyMessage(msg: AgentMessage): boolean {
  if (msg.role !== "assistant") return false;
  if ((msg as AssistantMessage).stopReason === "error") return false;
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) return false;
  let hasText = false;
  let hasToolUse = false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typedBlock = block as { type?: unknown; text?: unknown };
    if (typedBlock.type === "text" && typeof typedBlock.text === "string" && typedBlock.text.trim().length > 0) {
      hasText = true;
    }
    if (typedBlock.type === "toolUse") hasToolUse = true;
  }
  return hasText && !hasToolUse;
}

/**
 * Whether a bash call is likely to have changed the worktree's git state.
 *
 * Read from the arguments recorded on `tool_execution_start`: the end event
 * repeats only the tool *name*, so by the time we decide, the arguments from
 * the start are the only evidence left. Read-only commands (`git status`,
 * `git log`) match too — the wasted status fetch is negligible, and the caller
 * pops the server's cache with `force` so a `git commit` is not hidden behind
 * an earlier edit-triggered status.
 */
function bashCommandTouchesGit(args: unknown): boolean {
  if (!args || typeof args !== "object") return false;
  const command = (args as { command?: unknown }).command;
  if (typeof command !== "string" || command.length === 0) return false;
  return /\bgit\b/.test(command);
}

/** The text of every `{ type: "text" }` block of a tool-content array, in
 *  order. Shared by the partial-result merge and the stats report so the two
 *  cannot drift on what counts as a text block. */
function textBlocksOf(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") texts.push(typed.text);
  }
  return texts;
}

/** The text + details of a streamed partial result, in the shape the in-flight
 *  table and the tool-call stats store expect. `null` = nothing worth merging. */
function partialToolResultPatch(partial: unknown): { content?: { type: "text"; text: string }[]; details?: unknown } | null {
  if (!partial || typeof partial !== "object") return null;
  const value = partial as { content?: unknown; details?: unknown };
  const content = textBlocksOf(value.content).map((text) => ({ type: "text" as const, text }));
  if (content.length === 0 && value.details === undefined) return null;
  return {
    ...(content.length > 0 ? { content } : {}),
    ...(value.details !== undefined ? { details: value.details } : {}),
  };
}

/** The structural question guard the previous inline handler used: a malformed
 *  question is dropped rather than rendered. */
function isValidAskUserQuestion(question: unknown): question is AskUserQuestion {
  if (!question || typeof question !== "object") return false;
  const value = question as Partial<AskUserQuestion>;
  return typeof value.question === "string"
    && typeof value.header === "string"
    && typeof value.multiSelect === "boolean"
    && typeof value.required === "boolean"
    && Array.isArray(value.options);
}

/**
 * Take every "a turn is running" flag down: not running, not compacting, no
 * phase, no retry counter. Both turn-terminal events (`agent_end`,
 * `prompt_failed`) open by closing the turn. `compaction_end` is deliberately
 * not folded in here: it leaves `retryInfo` alone.
 */
function closeTurn(state: SessionRuntimeState): SessionRuntimeState {
  let next = patchSessionRuntimeState(state, "agentRunning", false);
  next = patchSessionRuntimeState(next, "isCompacting", false);
  next = patchSessionRuntimeState(next, "agentPhase", null);
  return patchSessionRuntimeState(next, "retryInfo", null);
}

/**
 * Reduce one session event into the runtime state plus the effects to run.
 *
 * Total over the protocol: a reduced event runs its branch below, and every
 * deliberately-ignored event returns the state untouched with no effects. That
 * is what makes the written "we know about it and do nothing" list executable —
 * the unit tests feed all 11 ignored events and assert nothing moves — and it
 * lets a test hand the reducer any frame the server can actually send.
 *
 * Nothing here is time- or I/O-dependent, so a test can feed an event sequence
 * and assert both the resulting state and the requested effects.
 */
export function reduceSessionEvent(
  state: SessionRuntimeState,
  event: SessionEvent,
): SessionEventReduction {
  if (!isReducedSessionEvent(event)) {
    // Deliberately ignored; see IGNORED_SESSION_EVENTS for the per-event
    // reason. Neither the state nor the effects move.
    return { state, effects: [] };
  }
  return reduceReducedSessionEvent(state, event);
}

/**
 * The reduced half. A `switch` over the reduced union with no `default:` —
 * completeness is the type system's job, not a fallback branch's: dropping a
 * branch from `ReducedSessionEventType` (or adding one) stops this compiling.
 */
function reduceReducedSessionEvent(
  state: SessionRuntimeState,
  event: ReducedSessionEvent,
): SessionEventReduction {
  switch (event.type) {
    case "permission_request":
      // No state: the confirmation queue lives in the adapter and is already
      // keyed by toolCallId, so a reconnect replay is a no-op there too.
      return {
        state,
        effects: [{
          kind: "enqueue_permission_request",
          toolCallId: event.toolCallId,
          ruleName: event.ruleName,
          command: event.command,
        }],
      };
    case "tool_execution_start": {
      const { toolCallId, toolName, args } = event;
      const argsRecord = asArgumentRecord(args);
      let next = patchSessionRuntimeState(state, "inFlightTools", (previous) =>
        upsertInFlightTool(previous, toolCallId, toolName, args));
      next = patchSessionRuntimeState(next, "agentPhase", (previous) => {
        const tools = previous?.kind === "running_tools" ? [...previous.tools] : [];
        if (!tools.some((tool) => tool.id === toolCallId)) {
          tools.push({ id: toolCallId, name: toolName, args: argsRecord });
        }
        return { kind: "running_tools", tools };
      });
      const effects: SessionEventEffect[] = [];
      // A spawning tool call is also spotted in the *message* that announces
      // it; this end of the ledger covers a start event arriving without one
      // (e.g. a reconnect mid-turn).
      if (toolName === "spawn_subagent" && state.seenSubagentToolStartIds.claim(toolCallId)) {
        effects.push({ kind: "refresh_subagent_panel", toolCallId });
      }
      effects.push({
        kind: "report_tool_call_stats",
        report: { type: "tool_start", toolCallId, toolName, args: argsRecord },
      });
      return { state: next, effects };
    }
    case "tool_execution_update": {
      const patch = partialToolResultPatch(event.partialResult);
      if (!patch) return { state, effects: [] };
      const inFlightTools = mergeInFlightToolPartialResult(state.inFlightTools, event.toolCallId, patch);
      // An update for a call that is not in flight is dropped, leaving the
      // state object identical — a replayed frame changes nothing.
      if (!inFlightTools) return { state, effects: [] };
      return {
        state: patchSessionRuntimeState(state, "inFlightTools", inFlightTools),
        effects: [],
      };
    }
    case "tool_execution_end": {
      const { toolCallId, result } = event;
      const isError = event.isError === true;
      const resultParts = result && typeof result === "object"
        ? result as { content?: unknown; details?: unknown }
        : undefined;
      // `tool_execution_end` repeats only the tool name and carries no args:
      // name, args and the decision "did this touch git?" all come from the
      // in-flight record written at start.
      const inFlight = state.inFlightTools.get(toolCallId);
      const toolName = inFlight?.name ?? event.toolName;
      const effects: SessionEventEffect[] = [];
      if (isError) effects.push({ kind: "flash_bot_state", stateKey: TOOL_ERROR_BOT_STATE });
      if (toolName === "spawn_subagent" && state.seenSubagentToolEndIds.claim(toolCallId)) {
        effects.push({ kind: "refresh_subagent_panel", toolCallId });
      }
      if (toolName && WORKTREE_MUTATING_TOOL_NAMES.has(toolName)) {
        effects.push({ kind: "invalidate_git_status", force: false });
      }
      // A git-level change (`git add` / `commit` / `stash`) must not fall into
      // the server's status cache behind an earlier edit-triggered fetch.
      if (toolName === "bash" && bashCommandTouchesGit(inFlight?.args)) {
        effects.push({ kind: "invalidate_git_status", force: true });
      }
      if (toolName && isShowFileToolName(toolName) && resultParts?.details) {
        const files = (resultParts.details as { files?: unknown }).files;
        if (Array.isArray(files)) {
          effects.push({ kind: "show_file_result", toolCallId, files: files as ShowFileEntry[] });
        }
      }
      if (toolName === CELEBRATE_TOOL_NAME && state.seenCelebrateToolEndIds.claim(toolCallId)) {
        effects.push({ kind: "celebrate", details: resultParts?.details as CelebrateDetails | undefined });
      }
      let resultText: string | undefined;
      const firstText = textBlocksOf(resultParts?.content)[0];
      if (firstText !== undefined) {
        resultText = firstText.length > 1024 ? `${firstText.slice(0, 1024)}…` : firstText;
      }
      effects.push({
        kind: "report_tool_call_stats",
        report: {
          type: "tool_end",
          toolCallId,
          isError,
          resultText,
          resultDetails: resultParts?.details,
        },
      });
      let next = patchSessionRuntimeState(state, "inFlightTools", (previous) =>
        removeInFlightTool(previous, toolCallId));
      next = patchSessionRuntimeState(next, "agentPhase", (previous) => {
        if (previous?.kind !== "running_tools") return previous;
        const tools = previous.tools.filter((tool) => tool.id !== toolCallId);
        return tools.length === 0 ? { kind: "waiting_model" } : { kind: "running_tools", tools };
      });
      return { state: next, effects };
    }
    case "ask_user_questions_request": {
      const questions = Array.isArray(event.questions)
        ? event.questions.filter(isValidAskUserQuestion)
        : [];
      if (typeof event.toolCallId !== "string" || questions.length === 0) {
        return { state, effects: [] };
      }
      // Claiming the tool-call id is the dedupe: on SSE reconnect the server
      // re-sends a pending request, which claims an id already claimed here, so
      // it neither re-opens the card nor rings a second time. The ledger is a
      // per-session, in-place set (like the other four), so the state object
      // identity does not change and no consumer re-renders for it.
      if (!state.seenAskUserQuestionsToolCallIds.claim(event.toolCallId)) {
        return { state, effects: [] };
      }
      const request: AskUserQuestionsRequestPayload = {
        toolCallId: event.toolCallId,
        questions,
        ts: event.ts,
      };
      return {
        state,
        effects: [
          { kind: "set_pending_ask_user_questions", request },
          { kind: "play_ui_sound", sound: "ask_user_questions" },
        ],
      };
    }
    case "message_start":
    case "message_update": {
      // Both events carry the whole partial message; the streamed content
      // itself lives in the streaming store, so the state only moves the
      // phase back to "assembling an answer". The `undefined` arm mirrors the
      // old handler, which tolerated a frame without a message.
      const message = event.message as AgentMessage | undefined;
      const effects: SessionEventEffect[] = [];
      pushSubagentRefreshes(state, message, effects);
      if (message && message.role !== "user") {
        effects.push({ kind: "stream_message", message: normalizeToolCalls(message) });
      }
      return { state: patchSessionRuntimeState(state, "agentPhase", null), effects };
    }
    case "message_end": {
      const completed = event.message as AgentMessage | undefined;
      const isAssistant = completed?.role === "assistant";
      const effects: SessionEventEffect[] = [];
      pushSubagentRefreshes(state, completed, effects);
      // A replayed `message_end` (SSE reconnect, compaction replay) carries an
      // equal-but-new object; `sameCompletedMessage` is what keeps the same
      // assistant message from being appended twice.
      let next = state;
      let settled: AgentMessage | null = null;
      if (completed && completed.role !== "user") {
        const normalized = normalizeToolCalls(completed);
        settled = normalized;
        next = patchSessionRuntimeState(next, "messages", (previous) =>
          previous.some((existing) => sameCompletedMessage(existing, normalized))
            ? previous
            : [...previous, normalized]);
      }
      if (isAssistant && state.awaitingFirstAssistant) {
        // One shot: clearing the flag here is what makes a replay silent.
        next = patchSessionRuntimeState(next, "awaitingFirstAssistant", false);
        effects.push({ kind: "first_assistant_ready" });
      }
      const keepForError = isAssistant && completed?.stopReason === "error";
      effects.push({ kind: "settle_stream", message: settled, keepForError });
      if (completed && isAssistant) {
        effects.push({
          kind: "record_assistant_outcome",
          isBody: isBodyMessage(completed),
          pendingError: keepForError ? (completed.errorMessage ?? FALLBACK_ASSISTANT_ERROR) : null,
        });
        // The refresh is an effect: the reducer neither waits for it nor
        // issues it, but the moment matches the old inline `fetch` exactly —
        // on every finished assistant message, before the turn ends.
        effects.push({ kind: "refresh_context_usage" });
      }
      next = patchSessionRuntimeState(next, "agentPhase", { kind: "waiting_model" });
      return { state: next, effects };
    }
    case "session_tree_update": {
      let next = state;
      if (Array.isArray(event.tree)) {
        next = patchSessionRuntimeState(next, "liveTree", event.tree as SessionTreeNode[]);
      }
      // A `null` leaf is deliberately not applied: the tree panel falls back
      // to the leaf loaded from disk, which is what the previous handler did.
      if (typeof event.leafId === "string") {
        next = patchSessionRuntimeState(next, "activeLeafId", event.leafId);
      }
      return { state: next, effects: [] };
    }
    case "agent_start": {
      // A new turn starts clean: the previous turn's error is gone, the
      // session is running again, and the turn's body-answer scratchpad is
      // reset. `pendingAssistantError` is deliberately *not* cleared — the
      // previous handler did not either; it is only cleared once surfaced.
      let next = patchSessionRuntimeState(state, "runtimeError", null);
      next = patchSessionRuntimeState(next, "agentRunning", true);
      next = patchSessionRuntimeState(next, "isCompacting", false);
      next = patchSessionRuntimeState(next, "agentPhase", { kind: "waiting_model" });
      next = patchSessionRuntimeState(next, "lastAssistantIsBody", false);
      return {
        state: next,
        effects: [
          { kind: "begin_stream" },
          { kind: "reset_tool_call_stats" },
          { kind: "refresh_system_prompt" },
          { kind: "set_bot_baseline" },
        ],
      };
    }
    case "agent_end": {
      // Closing the turn: every stage flag off, then the model error the
      // turn's assistant messages recorded, if any, is surfaced. Note that
      // "a pending error exists" is deliberately not the same as "the error
      // has text": an empty message still counts as a failed turn for the
      // kept streaming snapshot and the sound, exactly as the previous
      // handler had it.
      const pendingError = state.pendingAssistantError;
      const hadAssistantError = pendingError !== null;
      const isBody = state.lastAssistantIsBody;
      let next = closeTurn(state);
      const effects: SessionEventEffect[] = [
        { kind: "settle_stream", message: null, keepForError: hadAssistantError },
      ];
      if (pendingError) {
        next = patchSessionRuntimeState(next, "runtimeError", pendingError);
        next = patchSessionRuntimeState(next, "pendingAssistantError", null);
        effects.push({ kind: "show_error_toast", message: pendingError });
      }
      // The completion / failure sound fires whichever tab is visible: a
      // background turn still has to announce itself. The Pi Bot flash and the
      // toast are gated by the adapter on the visible tab.
      if (hadAssistantError) effects.push({ kind: "play_ui_sound", sound: "agent_failure" });
      else if (isBody) effects.push({ kind: "play_ui_sound", sound: "agent_success" });
      effects.push({ kind: "flash_bot_state", stateKey: isBody ? "happy" : "waking" });
      effects.push({ kind: "reload_session_after_turn" });
      effects.push({ kind: "notify_agent_end" });
      return { state: next, effects };
    }
    case "auto_retry_start":
      return {
        state: patchSessionRuntimeState(state, "retryInfo", {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          errorMessage: event.errorMessage,
        }),
        effects: [],
      };
    case "auto_retry_end": {
      let next = patchSessionRuntimeState(state, "retryInfo", null);
      const effects: SessionEventEffect[] = [];
      if (event.success === false) {
        const finalError = event.finalError;
        if (finalError) {
          next = patchSessionRuntimeState(next, "runtimeError", finalError);
          next = patchSessionRuntimeState(next, "pendingAssistantError", null);
          effects.push({ kind: "show_error_toast", message: finalError });
          effects.push({ kind: "play_ui_sound", sound: "agent_failure" });
        }
      }
      return { state: next, effects };
    }
    case "prompt_failed": {
      // A prompt that never started the turn: the same close-down as
      // `agent_end`, but with the error text the server reported and the event
      // stream dropped. The adapter has already resolved the i18n fallback.
      const next = patchSessionRuntimeState(closeTurn(state), "runtimeError", event.error);
      return {
        state: next,
        effects: [
          { kind: "settle_stream", message: null, keepForError: false },
          { kind: "show_error_toast", message: event.error },
          { kind: "close_events" },
        ],
      };
    }
    case "compaction_start": {
      let next = patchSessionRuntimeState(state, "agentRunning", true);
      next = patchSessionRuntimeState(next, "isCompacting", true);
      next = patchSessionRuntimeState(next, "agentPhase", { kind: "compacting" });
      return { state: next, effects: [] };
    }
    case "compaction_end": {
      const willRetry = event.willRetry === true;
      let next = patchSessionRuntimeState(state, "isCompacting", false);
      const effects: SessionEventEffect[] = [];
      if (willRetry) {
        // The retry keeps the turn alive, so the session is still busy and the
        // next thing that happens is another model call.
        next = patchSessionRuntimeState(next, "agentRunning", true);
        next = patchSessionRuntimeState(next, "agentPhase", { kind: "waiting_model" });
      } else {
        next = patchSessionRuntimeState(next, "agentRunning", false);
        next = patchSessionRuntimeState(next, "agentPhase", null);
        effects.push({ kind: "settle_stream", message: null, keepForError: false });
      }
      if (event.errorMessage) {
        effects.push({ kind: "show_compaction_error_toast", message: event.errorMessage });
      }
      if (!willRetry) {
        effects.push({ kind: "reload_session_after_compaction", aborted: event.aborted });
      }
      return { state: next, effects };
    }
    case "thinking_level_changed":
      // The protocol types the level, so the old `typeof === "string"` guard
      // could never fail; the cast maps the wire value onto the badge.
      return {
        state: patchSessionRuntimeState(
          state,
          "thinkingLevel",
          event.level as SessionRuntimeState["thinkingLevel"],
        ),
        effects: [],
      };
  }
}
