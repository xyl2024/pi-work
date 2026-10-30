import type { TurnResult } from "./turn";

export type SubagentEndStatus = "completed" | "failed" | "cancelled";

export interface SubagentEnd {
  status: SubagentEndStatus;
  error: string | null;
  partialOutput: boolean;
}

export type SubagentEndInput = Pick<TurnResult, "status" | "hasReply" | "error" | "stopReason">;

export const SUBAGENT_SESSION_CLOSED_ERROR = "Subagent stopped because the subagent session was closed";

export function toSubagentEnd(result: SubagentEndInput, maxRuntimeMs: number): SubagentEnd {
  switch (result.status) {
    case "completed":
      if (result.stopReason === "length") {
        return { status: "failed", error: "Subagent stopped after hitting the model's output token limit", partialOutput: true };
      }
      if (!result.hasReply) {
        return { status: "failed", error: "Subagent stopped without producing any response", partialOutput: false };
      }
      return { status: "completed", error: null, partialOutput: false };
    case "aborted":
      return {
        status: "cancelled",
        error: "Subagent was aborted before it finished (the subagent session was stopped externally)",
        partialOutput: true,
      };
    case "failed":
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
      return { status: "cancelled", error: result.error ?? "Subagent cancelled", partialOutput: false };
  }
}
