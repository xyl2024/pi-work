/**
 * The scheduler's mapping from the turn module's neutral terminal state onto
 * the run vocabulary and the two side-effect payloads a finished run produces.
 *
 * Pure — no session, no SQLite, no I/O — so the scheduler's only run-policy
 * decisions can be asserted directly:
 *  - a completed turn with no reply text is a failure here (kanban agrees;
 *    wechat deliberately does not — see
 *    docs/adr/0004-turn-execution-has-one-seam-and-waits-for-agent-settled.md).
 *    The pre-seam scheduler already failed an empty assistant reply; it
 *    recorded a *bare success* only when `agent_end` carried no assistant
 *    message at all, and an error with different wording when it carried no
 *    message snapshot. Both edge cases now land on the same "no final reply"
 *    failure, so the scheduler no longer has a terminal-state opinion of its
 *    own;
 *  - an aborted turn has no state of its own: it is recorded as `error`;
 *  - a timeout and an interruption are pushed as warnings, and only a real
 *    error or a timeout asks for a phone notification — an interruption from a
 *    server restart is shown in the runs tab, never blared to a phone.
 *
 * The side effects themselves (recordRunEnd, pushMessage, notify) stay in the
 * runner; this file only decides what they should say.
 */
import type { TurnResult } from "@/lib/server/turn";
import type { TaskRunStatus } from "./store";

/** Statuses a finished run can carry; `running` is written separately, when
 *  the session is acquired. Derived from the store's vocabulary so the two
 *  cannot drift. */
export type RunEndStatus = Exclude<TaskRunStatus, "running">;

/** The inbox push a finished run produces. */
export interface RunEndPush {
  level: "info" | "warn" | "error";
  body: string;
}

/** The notification a finished run asks for. */
export interface RunEndNotification {
  outcome: "success" | "error" | "timeout";
  text: string;
  detail: string;
}

export interface RunEnd {
  status: RunEndStatus;
  /** Full reply text on success, null otherwise. */
  replyText: string | null;
  /** Human-readable reason on failure, null on success. */
  error: string | null;
  push: RunEndPush;
  /** null when the run must stay silent (an interruption). */
  notification: RunEndNotification | null;
}

/** The part of a turn result the mapping reads — narrowed so a synthetic
 *  failure (a setup/dispatch error the turn module propagates rather than
 *  classifies) can be mapped without inventing session ids. */
export type RunEndInput = Pick<TurnResult, "status" | "text" | "hasReply" | "error">;

/** Inbox body truncation, kept from the pre-seam runner. */
export const PUSH_BODY_LIMIT = 200;
/** Notification headline truncation, kept from the pre-seam runner. */
export const NOTIFICATION_TEXT_LIMIT = 120;

/**
 * Map one turn result onto the scheduler's run end:
 *  - a non-completed turn (failed / aborted / timeout / interrupted) carries
 *    the turn module's error text;
 *  - a completed turn with no reply is a failure;
 *  - a successful reply is stored in full as `replyText` (the pre-seam runner
 *    stored the untruncated reply) while the push and the notification carry
 *    the truncations they always did.
 */
export function toRunEnd(result: RunEndInput, taskName: string): RunEnd {
  if (result.status === "completed" && result.hasReply) {
    return {
      status: "success",
      replyText: result.text,
      error: null,
      push: { level: "info", body: result.text.slice(0, PUSH_BODY_LIMIT) },
      notification: {
        outcome: "success",
        text: result.text.slice(0, NOTIFICATION_TEXT_LIMIT),
        detail: result.text,
      },
    };
  }

  const status: RunEndStatus =
    result.status === "timeout"
      ? "timeout"
      : result.status === "interrupted"
        ? "interrupted"
        : // completed-without-reply, failed and aborted all land on `error`
          "error";
  const error =
    result.status === "completed"
      ? // Same wording the pre-seam runner used when a turn settled with no text.
        "agent ended without a final assistant reply"
      : (result.error ?? `turn ${result.status}`);

  return {
    status,
    replyText: null,
    error,
    push: {
      level: status === "timeout" || status === "interrupted" ? "warn" : "error",
      body: error.slice(0, PUSH_BODY_LIMIT),
    },
    notification:
      status === "interrupted"
        ? null
        : {
            outcome: status === "timeout" ? "timeout" : "error",
            text: `${status === "timeout" ? "Timeout" : "Error"}: ${taskName}`,
            detail: error,
          },
  };
}
