import type { TurnResult } from "@/lib/server/turn";
import type { TaskRunStatus } from "./store";

export type RunEndStatus = Exclude<TaskRunStatus, "running">;

export interface RunEndNotification {
  outcome: "success" | "error" | "timeout";
  text: string;
  detail: string;
}

export interface RunEnd {
  status: RunEndStatus;
  replyText: string | null;
  error: string | null;
  notification: RunEndNotification | null;
}

export type RunEndInput = Pick<TurnResult, "status" | "text" | "hasReply" | "error">;

export const NOTIFICATION_TEXT_LIMIT = 120;

export function toRunEnd(result: RunEndInput, taskName: string): RunEnd {
  if (result.status === "completed" && result.hasReply) {
    return {
      status: "success",
      replyText: result.text,
      error: null,
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
        :
          "error";
  const error =
    result.status === "completed"
      ?
        "agent ended without a final assistant reply"
      : (result.error ?? `turn ${result.status}`);

  return {
    status,
    replyText: null,
    error,
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
