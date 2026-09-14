import { describe, expect, it } from "vitest";
import { toRunEnd } from "@/lib/server/scheduler/run-end";
import type { TurnResult } from "@/lib/server/turn";

/**
 * The scheduler's mapping from a turn result to the run record it writes, plus
 * the two side-effect payloads a finished run produces (the inbox push and the
 * phone notification).
 *
 * Pure — no session, no SQLite — so the scheduler's run-policy decisions (an
 * empty reply is a failure, an interruption stays silent, notification text
 * and truncation) are asserted directly.
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

describe("toRunEnd — the run record", () => {
  it("records success with the full reply as replyText", () => {
    const end = toRunEnd(result({ text: "all tests pass", hasReply: true, stopReason: "end_turn" }), "Nightly");
    expect(end.status).toBe("success");
    expect(end.replyText).toBe("all tests pass");
    expect(end.error).toBeNull();
  });

  it("treats a completed turn with no reply text as an error", () => {
    const end = toRunEnd(result({ status: "completed", text: "", hasReply: false }), "Nightly");
    expect(end.status).toBe("error");
    expect(end.replyText).toBeNull();
    expect(end.error).toBe("agent ended without a final assistant reply");
  });

  it("records an aborted turn as an error, carrying the turn error", () => {
    const end = toRunEnd(
      result({ status: "aborted", hasReply: false, error: "assistant stopReason=aborted" }),
      "Nightly",
    );
    expect(end.status).toBe("error");
    expect(end.replyText).toBeNull();
    expect(end.error).toBe("assistant stopReason=aborted");
  });

  it("records a failed turn as an error, carrying the turn error", () => {
    const end = toRunEnd(result({ status: "failed", hasReply: false, error: "missing api key" }), "Nightly");
    expect(end.status).toBe("error");
    expect(end.error).toBe("missing api key");
  });

  it("records a timeout as timeout", () => {
    const end = toRunEnd(
      result({ status: "timeout", hasReply: false, error: "max lifetime exceeded: 7200000ms" }),
      "Nightly",
    );
    expect(end.status).toBe("timeout");
    expect(end.error).toBe("max lifetime exceeded: 7200000ms");
  });

  it("records an interrupted turn as interrupted", () => {
    const end = toRunEnd(
      result({ status: "interrupted", hasReply: false, error: "agent session destroyed before agent_end" }),
      "Nightly",
    );
    expect(end.status).toBe("interrupted");
    expect(end.error).toBe("agent session destroyed before agent_end");
  });

  it("falls back to a generic error when a non-completed turn gives none", () => {
    expect(toRunEnd(result({ status: "failed", error: null }), "Nightly").error).toBe("turn failed");
    expect(toRunEnd(result({ status: "timeout", error: null }), "Nightly").error).toBe("turn timeout");
    expect(toRunEnd(result({ status: "interrupted", error: null }), "Nightly").error).toBe(
      "turn interrupted",
    );
  });
});

describe("toRunEnd — inbox push", () => {
  it("pushes info with the reply on success", () => {
    const end = toRunEnd(result({ text: "done", hasReply: true }), "Nightly");
    expect(end.push).toEqual({ level: "info", body: "done" });
  });

  it("pushes warn for timeout and interrupted, error otherwise", () => {
    expect(toRunEnd(result({ status: "timeout", error: "late" }), "Nightly").push.level).toBe("warn");
    expect(toRunEnd(result({ status: "interrupted", error: "gone" }), "Nightly").push.level).toBe("warn");
    expect(toRunEnd(result({ status: "failed", error: "boom" }), "Nightly").push.level).toBe("error");
    expect(toRunEnd(result({ hasReply: false }), "Nightly").push.level).toBe("error");
  });

  it("truncates the pushed body to 200 characters", () => {
    const long = "x".repeat(2500);
    expect(toRunEnd(result({ text: long, hasReply: true }), "Nightly").push.body).toBe("x".repeat(200));
    expect(toRunEnd(result({ status: "failed", error: long }), "Nightly").push.body).toBe("x".repeat(200));
  });
});

describe("toRunEnd — notification", () => {
  it("asks for a success notification with the reply, text capped at 120 characters", () => {
    const long = "y".repeat(300);
    const end = toRunEnd(result({ text: long, hasReply: true }), "Nightly");
    expect(end.notification).toEqual({ outcome: "success", text: "y".repeat(120), detail: long });
  });

  it("asks for an error notification named after the task", () => {
    const end = toRunEnd(result({ status: "failed", error: "boom" }), "Nightly");
    expect(end.notification).toEqual({ outcome: "error", text: "Error: Nightly", detail: "boom" });
  });

  it("asks for a timeout notification named after the task", () => {
    const end = toRunEnd(result({ status: "timeout", error: "late" }), "Nightly");
    expect(end.notification).toEqual({ outcome: "timeout", text: "Timeout: Nightly", detail: "late" });
  });

  it("keeps an interrupted run silent", () => {
    const end = toRunEnd(result({ status: "interrupted", error: "gone" }), "Nightly");
    expect(end.notification).toBeNull();
  });
});
