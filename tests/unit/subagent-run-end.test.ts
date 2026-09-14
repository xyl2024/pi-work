import { describe, expect, it } from "vitest";
import { SUBAGENT_SESSION_CLOSED_ERROR, toSubagentEnd } from "@/lib/server/subagent-run-end";
import type { TurnResult } from "@/lib/server/turn";

/**
 * The spawn_subagent tool's mapping from a turn result to the subagent
 * vocabulary the parent agent and the subagents.db row see. Pure — no session,
 * no SQLite — so the tool's run-policy decisions (an empty reply is a failure,
 * which stops are cancelled, the runtime-limit wording) are asserted directly.
 */

const MAX_RUNTIME_MS = 15 * 60 * 1000;

function result(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    status: "completed",
    text: "",
    hasReply: false,
    error: null,
    stopReason: null,
    sessionId: "key-1",
    realSessionId: "real-1",
    ...overrides,
  };
}

describe("toSubagentEnd", () => {
  it("completes a turn that produced a reply", () => {
    expect(
      toSubagentEnd(result({ text: "found it", hasReply: true, stopReason: "end_turn" }), MAX_RUNTIME_MS),
    ).toEqual({ status: "completed", error: null, partialOutput: false });
  });

  it("fails a completed turn that produced no reply", () => {
    expect(toSubagentEnd(result({ stopReason: "end_turn" }), MAX_RUNTIME_MS)).toEqual({
      status: "failed",
      error: "Subagent stopped without producing any response",
      partialOutput: false,
    });
  });

  it("fails a turn truncated at the output token limit, offering the partial output", () => {
    expect(
      toSubagentEnd(result({ text: "half an ans", hasReply: true, stopReason: "length" }), MAX_RUNTIME_MS),
    ).toEqual({
      status: "failed",
      error: "Subagent stopped after hitting the model's output token limit",
      partialOutput: true,
    });
  });

  it("fails a provider error under the subagent's own wording", () => {
    expect(
      toSubagentEnd(
        result({ status: "failed", error: "rate limited", stopReason: "error" }),
        MAX_RUNTIME_MS,
      ),
    ).toEqual({ status: "failed", error: "Subagent run failed: rate limited", partialOutput: true });
  });

  it("keeps the turn's own error when the turn failed before the child ran", () => {
    // A prompt failure carries no assistant stopReason: the turn module's
    // message is the most specific thing there is to report.
    expect(toSubagentEnd(result({ status: "failed", error: "missing api key" }), MAX_RUNTIME_MS)).toEqual({
      status: "failed",
      error: "missing api key",
      partialOutput: false,
    });
  });

  it("cancels a child that stopped itself, naming the external stop", () => {
    expect(toSubagentEnd(result({ status: "aborted", error: "aborted", stopReason: "aborted" }), MAX_RUNTIME_MS)).toEqual({
      status: "cancelled",
      error: "Subagent was aborted before it finished (the subagent session was stopped externally)",
      partialOutput: true,
    });
  });

  it("cancels a turn cut short by one of the tool's own stop sources", () => {
    expect(
      toSubagentEnd(result({ status: "cancelled", error: "Subagent stopped because the parent session was stopped" }), MAX_RUNTIME_MS),
    ).toEqual({
      status: "cancelled",
      error: "Subagent stopped because the parent session was stopped",
      partialOutput: false,
    });
  });

  it("cancels an interrupted turn as the closed child session it is", () => {
    expect(toSubagentEnd(result({ status: "interrupted", error: "agent session destroyed before agent_end" }), MAX_RUNTIME_MS)).toEqual({
      status: "cancelled",
      error: SUBAGENT_SESSION_CLOSED_ERROR,
      partialOutput: false,
    });
  });

  it("fails a timeout with the runtime limit this tool passed in", () => {
    expect(
      toSubagentEnd(result({ status: "timeout", error: "max lifetime exceeded: 900000ms" }), MAX_RUNTIME_MS),
    ).toEqual({
      status: "failed",
      error: "Subagent exceeded the 15-minute runtime limit",
      partialOutput: false,
    });
  });
});
