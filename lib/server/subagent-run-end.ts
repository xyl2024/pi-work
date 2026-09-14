/**
 * The spawn_subagent tool's mapping from the turn module's neutral terminal
 * state onto the subagent vocabulary the parent agent and the `subagents.db`
 * row see.
 *
 * Pure — no session, no SQLite, no I/O — so the tool's run-policy decisions can
 * be asserted directly. The pre-seam tool kept its own wait
 * (`subagent-tool.ts:waitForAgentEnd`) plus a hand-tracked terminal state; this
 * mapping keeps the same verdicts and the same wording as that wait for every
 * terminal state it had, while the wait itself now goes through
 * `lib/server/turn` (see
 * docs/adr/0004-turn-execution-has-one-seam-and-waits-for-agent-settled.md).
 *
 * One verdict necessarily narrows. The pre-seam wait tracked `sawAssistant` (an
 * assistant message arrived at all) and called a settle with an assistant
 * message but no text a `completed` run with an empty result; the module reports
 * only the stronger fact `hasReply` (the final assistant message carries text).
 * An empty assistant message therefore now fails with "stopped without
 * producing any response", which is the same verdict the board's and the
 * scheduler's mappings give an empty reply.
 *
 * Three verdicts are this caller's own — the turn module reports facts, not
 * verdicts:
 *  - a turn that produced no reply text is a failure here, exactly like the
 *    board's and the scheduler's mapping;
 *  - a cancelled child is `cancelled` (the tool's stop sources and a session
 *    that stopped itself), everything else that did not complete is `failed`;
 *  - a timeout carries this tool's own wording, since the module's generic one
 *    (`max lifetime exceeded: <ms>`) is not what the parent agent used to read.
 */
import type { TurnResult } from "./turn";

/** The statuses a finished subagent run can carry; `running` is written when the child session starts. */
export type SubagentEndStatus = "completed" | "failed" | "cancelled";

/** What the tool records and reports for one finished child turn. */
export interface SubagentEnd {
  status: SubagentEndStatus;
  /** Reason to record and report on a non-completed run; null on completion. */
  error: string | null;
  /**
   * Whether the child's last assistant text should be attached to the error as
   * its partial output (`\n\nLast partial output:\n…`) — the abnormal stops the
   * pre-seam tool re-read the session for. The `subagents.db` row always
   * records the bare reason; only the tool result carries the partial.
   */
  partialOutput: boolean;
}

/** The part of a turn result the mapping reads. */
export type SubagentEndInput = Pick<TurnResult, "status" | "hasReply" | "error" | "stopReason">;

/**
 * Reason for a child session that was destroyed from outside while the tool was
 * waiting on it (deleted from the UI, idle reap, process-exit cleanup). The
 * turn module reports the fact as `interrupted`; this is the wording the
 * subagent path has always shown the parent agent.
 */
export const SUBAGENT_SESSION_CLOSED_ERROR = "Subagent stopped because the subagent session was closed";

/**
 * Map one turn result onto the subagent's end. `maxRuntimeMs` is the deadline
 * this tool handed the module, used only to word the timeout.
 */
export function toSubagentEnd(result: SubagentEndInput, maxRuntimeMs: number): SubagentEnd {
  switch (result.status) {
    case "completed":
      // The output limit is reported through stopReason, and the child was
      // truncated mid-answer: that is not a completed task.
      if (result.stopReason === "length") {
        return { status: "failed", error: "Subagent stopped after hitting the model's output token limit", partialOutput: true };
      }
      if (!result.hasReply) {
        return { status: "failed", error: "Subagent stopped without producing any response", partialOutput: false };
      }
      return { status: "completed", error: null, partialOutput: false };
    case "aborted":
      // The child session stopped itself (its own abort), so it is cancelled
      // rather than failed — the wording kept from the pre-seam tool.
      return {
        status: "cancelled",
        error: "Subagent was aborted before it finished (the subagent session was stopped externally)",
        partialOutput: true,
      };
    case "failed":
      // `stopReason === "error"` is the child's own provider error; without it
      // the turn failed before pi started (a prompt failure), and the module's
      // message is the most specific thing there is to report.
      return result.stopReason === "error"
        ? { status: "failed", error: `Subagent run failed: ${result.error ?? "model/provider error"}`, partialOutput: true }
        : { status: "failed", error: result.error ?? "Subagent prompt failed", partialOutput: false };
    case "timeout":
      return {
        status: "failed",
        error: `Subagent exceeded the ${maxRuntimeMs / 60_000}-minute runtime limit`,
        partialOutput: false,
      };
    case "interrupted":
      return { status: "cancelled", error: SUBAGENT_SESSION_CLOSED_ERROR, partialOutput: false };
    case "cancelled":
      // `error` is the stop source's own reason ("Subagent cancelled", "…the
      // parent session was stopped", "…the subagent session was closed").
      return { status: "cancelled", error: result.error ?? "Subagent cancelled", partialOutput: false };
  }
}
