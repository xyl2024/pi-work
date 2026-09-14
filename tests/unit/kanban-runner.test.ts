import { describe, expect, it } from "vitest";
import { toCardRunEnd } from "@/lib/server/kanban/run-end";
import type { TurnResult } from "@/lib/server/turn";

/**
 * The Kanban board's mapping from a turn result to the card's review_test
 * write. Pure — no session, no SQLite — so the board's run-policy decisions
 * (empty reply is a failure, summary truncation, error pass-through) are
 * asserted directly.
 */

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

describe("toCardRunEnd", () => {
  it("stores the reply as the summary on a clean completion", () => {
    expect(toCardRunEnd(result({ text: "all tests pass", hasReply: true, stopReason: "end_turn" }))).toEqual({
      resultSummary: "all tests pass",
      error: null,
    });
  });

  it("truncates a long reply to the card's 2000-character limit", () => {
    const text = "x".repeat(2500);
    const end = toCardRunEnd(result({ text, hasReply: true }));
    expect(end.resultSummary).toBe("x".repeat(2000));
    expect(end.error).toBeNull();
  });

  it("treats a completed turn with no reply text as a failure", () => {
    expect(toCardRunEnd(result({ status: "completed", text: "", hasReply: false }))).toEqual({
      resultSummary: null,
      error: "agent ended without a final assistant reply",
    });
  });

  it("carries the turn error for a failed turn", () => {
    expect(toCardRunEnd(result({ status: "failed", text: "", hasReply: false, error: "missing api key" }))).toEqual({
      resultSummary: null,
      error: "missing api key",
    });
  });

  it("carries the turn error for an aborted turn", () => {
    expect(
      toCardRunEnd(result({ status: "aborted", hasReply: false, error: "assistant stopReason=aborted" })),
    ).toEqual({ resultSummary: null, error: "assistant stopReason=aborted" });
  });

  it("carries the turn error for a timeout", () => {
    expect(toCardRunEnd(result({ status: "timeout", hasReply: false, error: "max lifetime exceeded: 7200000ms" }))).toEqual({
      resultSummary: null,
      error: "max lifetime exceeded: 7200000ms",
    });
  });

  it("carries the turn error for an interrupted turn", () => {
    expect(
      toCardRunEnd(result({ status: "interrupted", hasReply: false, error: "agent session destroyed before agent_end" })),
    ).toEqual({ resultSummary: null, error: "agent session destroyed before agent_end" });
  });

  it("truncates a long error and falls back when the turn gave none", () => {
    expect(toCardRunEnd(result({ status: "failed", error: "e".repeat(2500) })).error).toBe("e".repeat(2000));
    expect(toCardRunEnd(result({ status: "timeout", error: null })).error).toBe("turn timeout");
  });
});
