/**
 * The wechat channel's mapping from the turn module's neutral terminal state
 * onto the one thing an inbound message produces: the reply that goes back to
 * the user.
 *
 * Pure — no session, no SQLite, no I/O — so this channel's only reply-policy
 * decisions can be asserted directly:
 *  - a completed turn with no reply text is a *success* here, answered with a
 *    fallback line (wechat's documented current behaviour; the scheduler and
 *    the board deliberately disagree — see
 *    docs/adr/0004-turn-execution-has-one-seam-and-waits-for-agent-settled.md);
 *  - a timeout keeps the wording this channel has always shown its users
 *    ("agent_end timed out after <deadline>ms") rather than the turn module's;
 *  - every other non-completed turn carries the turn module's error text.
 *
 * The side effects themselves (the reply API call, the activity push, the
 * sessions.log line) stay in the inbound handler; this file only decides what
 * they should say.
 */
import type { TurnResult } from "@/lib/server/turn";

/** What wechat says when the agent settled without producing any text. */
export const EMPTY_REPLY_FALLBACK = "（agent 没有产生输出）";

/** The part of a turn result this mapping reads — narrowed so a synthetic
 *  failure can be mapped without inventing session ids. */
export type InboundTurnResult = Pick<TurnResult, "status" | "text" | "hasReply" | "error">;

/** The reply decision for one finished inbound turn. */
export interface InboundReply {
  /** True only for a completed turn; `error` then holds the failure reason. */
  ok: boolean;
  /** Text to send back on success (the empty-reply fallback included); "" on failure. */
  text: string;
  /** Failure reason when `!ok`; null on success. */
  error: string | null;
}

/**
 * Decide how wechat answers one turn:
 *  - `completed` is a success whether or not the agent produced text; an empty
 *    reply is answered with the fallback line;
 *  - a timeout is reported with this channel's own wording;
 *  - anything else (failed / aborted / interrupted / cancelled) is a failure
 *    carrying the turn module's error text.
 */
export function toInboundReply(result: InboundTurnResult, timeoutMs: number): InboundReply {
  if (result.status === "completed") {
    return { ok: true, text: result.hasReply ? result.text : EMPTY_REPLY_FALLBACK, error: null };
  }
  if (result.status === "timeout") {
    return { ok: false, text: "", error: `agent_end timed out after ${timeoutMs}ms` };
  }
  return { ok: false, text: "", error: result.error ?? `turn ${result.status}` };
}
