/**
 * Pure terminal-state judgement for one turn.
 *
 * This is the decision half of the turn module (see
 * `docs/adr/0004-turn-execution-has-one-seam-and-waits-for-agent-settled.md`):
 * no session, no I/O, no side effects. Given the snapshot a turn's event stream
 * has produced so far and the reason the wait ended, it answers the only
 * question this layer owns — how did the turn end, and what was the final
 * reply text?
 *
 * It reports facts, not verdicts. In particular "the turn produced no reply
 * text" is a fact (`hasReply === false`); whether that counts as success is the
 * caller's policy (kanban and the scheduler treat it as a failure, wechat
 * replies with a fallback line and treats it as success).
 */

/** The message shape `agent_end` reports: the low-level run's conversation. */
export interface TurnMessage {
  role?: string;
  content?: Array<{ type?: string; text?: string }> | unknown;
  stopReason?: string;
  errorMessage?: string;
}

/** Minimal event shape the module reads. */
export interface TurnEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Everything a turn's event stream has told us so far, folded into data.
 *
 * `agent_end` is the only event that carries a messages snapshot, and
 * `agent_settled` carries no payload at all — so the last finished low-level
 * run is where the final assistant message lives.
 */
export interface TurnSnapshot {
  /**
   * Messages of the most recent `agent_end`, or null if none happened yet.
   * Every `agent_end` replaces it, so a retry's snapshot supersedes the failed
   * attempt's.
   */
  lastRunMessages: TurnMessage[] | null;
  /** Error reported by the most recent `agent_end`, if any (null once a retry ends cleanly). */
  error: string | null;
}

export const EMPTY_TURN_SNAPSHOT: TurnSnapshot = { lastRunMessages: null, error: null };

/** Fold one event into the snapshot. Only `agent_end` contributes state. */
export function observeTurnEvent(snapshot: TurnSnapshot, event: TurnEvent): TurnSnapshot {
  if (event.type !== "agent_end") return snapshot;
  const messages = Array.isArray(event.messages) ? (event.messages as TurnMessage[]) : null;
  const error = typeof event.error === "string" && event.error ? event.error : null;
  return { lastRunMessages: messages, error };
}

/** Neutral terminal states. Callers map these onto their own vocabulary. */
export type TurnStatus = "completed" | "aborted" | "failed" | "timeout" | "interrupted" | "cancelled";

/**
 * Why the wait for the turn ended. `settled`/`failed` come from the event
 * stream; `timeout`/`interrupted`/`cancelled` are the caller's own policy (the
 * caller owns the deadline and the abort sources, and it is the caller's
 * session-destroy listener that reports an interruption).
 *
 * `aborted` (a session that stopped itself with `stopReason === "aborted"`) is a
 * different fact from `cancelled` (one of the caller's abort sources fired and
 * the module told the session to stop); both are terminal states.
 */
export type TurnEndReason =
  | { kind: "settled" }
  | { kind: "timeout"; deadlineMs: number }
  | { kind: "interrupted" }
  | { kind: "failed"; error: string }
  | { kind: "cancelled"; reason: string };

/** What one turn ended up being. */
export interface TurnOutcome {
  status: TurnStatus;
  /** Final assistant reply text, raw (not trimmed); "" when there was none. */
  text: string;
  /** The distinguishable fact "this turn produced reply text". Not a verdict. */
  hasReply: boolean;
  /** Human-readable reason for a failed/aborted/timeout/interrupted turn; null on a clean completion. */
  error: string | null;
  /** Raw `stopReason` of the last assistant message, or null. "length" here is the output-limit stop. */
  stopReason: string | null;
}

/**
 * The end reason an event implies, or null when the event does not end the turn.
 *
 * Only `agent_settled` settles a turn. `agent_end` marks one low-level run and
 * may still be followed by a retry, a compaction retry or a queued
 * continuation — `willRetry` only says whether *this* attempt will retry, so
 * neither value of it makes `agent_end` terminal.
 */
export function eventTurnEndReason(event: TurnEvent): TurnEndReason | null {
  if (event.type === "agent_settled") return { kind: "settled" };
  if (event.type === "prompt_failed") {
    const error = typeof event.error === "string" && event.error ? event.error : "prompt failed";
    return { kind: "failed", error };
  }
  return null;
}

/**
 * Judge a turn that ended for the given reason, using the snapshot observed so
 * far for the final reply text.
 */
export function classifyTurnEnd(snapshot: TurnSnapshot, reason: TurnEndReason): TurnOutcome {
  if (reason.kind === "timeout") {
    // Wording kept from the pre-seam runners so migrating callers record the
    // same error text they used to.
    return outcome("timeout", "", false, `max lifetime exceeded: ${reason.deadlineMs}ms`, null);
  }
  if (reason.kind === "interrupted") {
    return outcome("interrupted", "", false, "agent session destroyed before agent_end", null);
  }
  if (reason.kind === "failed") {
    return outcome("failed", "", false, reason.error, null);
  }
  if (reason.kind === "cancelled") {
    // The caller's abort source fired; `reason` is its wording. No reply text:
    // the turn was cut short, and a partial result is the caller's to re-read
    // (the subagent path does) rather than something this layer invents.
    return outcome("cancelled", "", false, reason.reason, null);
  }

  const last = lastAssistantMessage(snapshot.lastRunMessages);
  const text = last ? assistantText(last) : "";
  const stopReason = typeof last?.stopReason === "string" ? last.stopReason : null;
  const hasReply = hasReplyText(text);

  if (snapshot.error) {
    return outcome("failed", text, hasReply, snapshot.error, stopReason);
  }
  if (stopReason === "error") {
    return outcome("failed", text, hasReply, last?.errorMessage || "assistant stopReason=error", stopReason);
  }
  if (stopReason === "aborted") {
    return outcome("aborted", text, hasReply, last?.errorMessage || "assistant stopReason=aborted", stopReason);
  }
  // A clean settle. `stopReason === "length"` still lands here: the truncation
  // is reported through `stopReason`, and whether it is a failure is the
  // caller's call (the subagent path treats it as one).
  return outcome("completed", text, hasReply, null, stopReason);
}

function outcome(
  status: TurnStatus,
  text: string,
  hasReply: boolean,
  error: string | null,
  stopReason: string | null,
): TurnOutcome {
  return { status, text, hasReply, error, stopReason };
}

function lastAssistantMessage(messages: TurnMessage[] | null): TurnMessage | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return messages[i];
  }
  return null;
}

/** Concatenate the message's text blocks, exactly as the pre-seam runners did. */
function assistantText(message: TurnMessage): string {
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block): block is { type?: string; text?: string } => block?.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function hasReplyText(text: string): boolean {
  return text.trim().length > 0;
}
