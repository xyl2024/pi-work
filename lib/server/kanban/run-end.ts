/**
 * The board's mapping from the turn module's neutral terminal state onto the
 * card vocabulary. Pure — no session, no store, no I/O — so the board's only
 * run-policy decisions can be asserted directly.
 *
 * `review_test` is implied for every run end: both success and failure land
 * there and the user decides what follows.
 */
import type { TurnResult } from "@/lib/server/turn";

/** The card's summary / error length limit; both are stored truncated. */
export const CARD_TEXT_LIMIT = 2000;

/** The card write a finished run produces. */
export interface CardRunEnd {
  resultSummary: string | null;
  error: string | null;
}

/**
 * Map one turn result onto the board's vocabulary:
 *  - a non-completed turn (failed / aborted / timeout / interrupted) carries
 *    the turn module's error text;
 *  - a completed turn with no reply text is a failure here (the scheduler
 *    agrees; wechat deliberately does not — see
 *    docs/adr/0004-turn-execution-has-one-seam-and-waits-for-agent-settled.md);
 *  - a successful reply becomes the card's result summary, truncated to the
 *    card's length limit.
 */
export function toCardRunEnd(result: TurnResult): CardRunEnd {
  if (result.status !== "completed") {
    return { resultSummary: null, error: (result.error ?? `turn ${result.status}`).slice(0, CARD_TEXT_LIMIT) };
  }
  if (!result.hasReply) {
    // Same wording the pre-seam runner used when a turn settled with no text.
    return { resultSummary: null, error: "agent ended without a final assistant reply" };
  }
  return { resultSummary: result.text.slice(0, CARD_TEXT_LIMIT), error: null };
}
