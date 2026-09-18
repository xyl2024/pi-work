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
import type { UiSoundEventId } from "./config-types";
import type { SessionRuntimeState } from "./session-runtime-state";

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
  tool_execution_start: "Adds an in-flight tool call (name + args) and reports it to the tool-call stats.",
  tool_execution_update: "Merges a partial tool result into the in-flight tool call.",
  tool_execution_end: "Retires the in-flight tool call; the args recorded at start decide git invalidation.",
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
// The port is incremental (#60–#63): this reducer only has a branch for the
// event types in `PORTED_SESSION_EVENT_TYPES`, and the hook's legacy `switch`
// still owns the rest until #64 deletes it.

/**
 * The events `reduceSessionEvent` already reduces.
 *
 * Each slice widens this list and deletes the matching legacy `switch` case;
 * #64 finishes the port, at which point this becomes `ReducedSessionEventType`
 * and the guard below disappears.
 */
export const PORTED_SESSION_EVENT_TYPES = [
  "permission_request",
  "ask_user_questions_request",
] as const satisfies readonly ReducedSessionEventType[];

export type PortedSessionEventType = (typeof PORTED_SESSION_EVENT_TYPES)[number];

/** The ported events, as protocol members. */
export type PortedSessionEvent = Extract<SessionEvent, { type: PortedSessionEventType }>;

/** Runtime guard the adapter uses to route an SSE frame to the reducer. */
export function isPortedSessionEvent(event: SessionEvent): event is PortedSessionEvent {
  return (PORTED_SESSION_EVENT_TYPES as readonly SessionEventType[]).includes(event.type);
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
  | { kind: "play_ui_sound"; sound: UiSoundEventId };

/** What one event does to the runtime state, and the effects it asks for. */
export interface SessionEventReduction {
  state: SessionRuntimeState;
  effects: SessionEventEffect[];
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
 * Reduce one session event into the runtime state plus the effects to run.
 *
 * Nothing here is time- or I/O-dependent, so a test can feed an event sequence
 * and assert both the resulting state and the requested effects.
 */
export function reduceSessionEvent(
  state: SessionRuntimeState,
  event: PortedSessionEvent,
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
  }
}
