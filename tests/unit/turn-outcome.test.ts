import { describe, expect, it } from "vitest";
import {
  EMPTY_TURN_SNAPSHOT,
  classifyTurnEnd,
  eventTurnEndReason,
  observeTurnEvent,
  type TurnEvent,
  type TurnSnapshot,
} from "@/lib/server/turn";

/** Fold a scripted event sequence into the snapshot the classifier consumes. */
function observe(events: TurnEvent[]): TurnSnapshot {
  return events.reduce(observeTurnEvent, EMPTY_TURN_SNAPSHOT);
}

const runEnd = (messages: unknown, extra: Record<string, unknown> = {}): TurnEvent => ({
  type: "agent_end",
  messages,
  willRetry: false,
  ...extra,
});

const assistant = (text: string, extra: Record<string, unknown> = {}) => ({
  role: "assistant",
  content: [{ type: "text", text }],
  stopReason: "end_turn",
  ...extra,
});

const REPLY = assistant("done");

describe("eventTurnEndReason", () => {
  it("ends the turn on agent_settled", () => {
    expect(eventTurnEndReason({ type: "agent_settled" })).toEqual({ kind: "settled" });
  });

  it.each([true, false])("does NOT end the turn on agent_end (willRetry=%s)", (willRetry) => {
    expect(eventTurnEndReason({ type: "agent_end", willRetry, messages: [] })).toBeNull();
  });

  it("ignores ordinary streaming events", () => {
    for (const type of ["agent_start", "message_end", "message_start", "tool_start", "compaction_start"]) {
      expect(eventTurnEndReason({ type }), type).toBeNull();
    }
  });

  it("ends the turn as failed when the prompt dispatch fails", () => {
    expect(eventTurnEndReason({ type: "prompt_failed", error: "boom" })).toEqual({
      kind: "failed",
      error: "boom",
    });
    expect(eventTurnEndReason({ type: "prompt_failed" })).toEqual({
      kind: "failed",
      error: "prompt failed",
    });
  });
});

describe("observeTurnEvent", () => {
  it("remembers the last agent_end messages and ignores everything else", () => {
    const first = runEnd([assistant("first")]);
    const second = runEnd([assistant("second")]);
    const snapshot = observe([
      first,
      { type: "message_end", message: assistant("streaming") },
      { type: "agent_settled" },
      second,
    ]);
    expect(snapshot.lastRunMessages).toEqual([assistant("second")]);
    expect(snapshot.error).toBeNull();
  });

  it("clears a failed attempt's error when a later retry ends cleanly", () => {
    const failed = observe([runEnd([], { error: "provider exploded", willRetry: true })]);
    expect(failed.error).toBe("provider exploded");

    const recovered = observe([
      runEnd([], { error: "provider exploded", willRetry: true }),
      runEnd([REPLY]),
    ]);
    expect(recovered.error).toBeNull();
    expect(recovered.lastRunMessages).toEqual([REPLY]);
  });

  it("treats a non-array messages payload as no snapshot", () => {
    expect(observe([runEnd(undefined)]).lastRunMessages).toBeNull();
    expect(observe([runEnd("nope")]).lastRunMessages).toBeNull();
  });

  it("returns the same snapshot unchanged for unrelated events", () => {
    const before = observe([runEnd([REPLY])]);
    expect(observeTurnEvent(before, { type: "message_end" })).toBe(before);
    expect(observeTurnEvent(before, { type: "agent_settled" })).toBe(before);
  });
});

describe("classifyTurnEnd — settle", () => {
  it("reports completed with the last assistant reply", () => {
    const outcome = classifyTurnEnd(observe([runEnd([assistant("older"), REPLY])]), { kind: "settled" });
    expect(outcome).toEqual({
      status: "completed",
      text: "done",
      hasReply: true,
      error: null,
      stopReason: "end_turn",
    });
  });

  it("joins every text block of the final assistant message", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "thinking", text: "hmm" },
        { type: "text", text: "part one " },
        { type: "tool_use", id: "t" },
        { type: "text", text: "part two" },
      ],
      stopReason: "end_turn",
    };
    const outcome = classifyTurnEnd(observe([runEnd([message])]), { kind: "settled" });
    expect(outcome.text).toBe("part one part two");
    expect(outcome.hasReply).toBe(true);
  });

  it("reports failed when the final low-level run carried an error", () => {
    const outcome = classifyTurnEnd(observe([runEnd([], { error: "provider exploded" })]), {
      kind: "settled",
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("provider exploded");
  });

  it("reports failed when the last assistant message stopped with an error", () => {
    const outcome = classifyTurnEnd(
      observe([runEnd([assistant("partial", { stopReason: "error", errorMessage: "rate limited" })])]),
      { kind: "settled" },
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("rate limited");
    expect(outcome.text).toBe("partial");
    expect(outcome.hasReply).toBe(true);
  });

  it("reports failed without an errorMessage using the stopReason fallback", () => {
    const outcome = classifyTurnEnd(
      observe([runEnd([assistant("", { stopReason: "error" })])]),
      { kind: "settled" },
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("assistant stopReason=error");
  });

  it("reports aborted when the last assistant message was aborted", () => {
    const outcome = classifyTurnEnd(
      observe([runEnd([assistant("partial", { stopReason: "aborted", errorMessage: "interrupted by user" })])]),
      { kind: "settled" },
    );
    expect(outcome.status).toBe("aborted");
    expect(outcome.error).toBe("interrupted by user");
    expect(outcome.stopReason).toBe("aborted");
  });

  it("keeps the raw stopReason so the output-limit stop is identifiable", () => {
    const outcome = classifyTurnEnd(
      observe([runEnd([assistant("truncated", { stopReason: "length" })])]),
      { kind: "settled" },
    );
    expect(outcome.status).toBe("completed");
    expect(outcome.stopReason).toBe("length");
  });
});

describe("classifyTurnEnd — no reply is a fact, not a verdict", () => {
  it("reports completed with hasReply=false when no assistant message arrived", () => {
    const outcome = classifyTurnEnd(observe([runEnd([])]), { kind: "settled" });
    expect(outcome.status).toBe("completed");
    expect(outcome.text).toBe("");
    expect(outcome.hasReply).toBe(false);
    expect(outcome.error).toBeNull();
  });

  it("treats a whitespace-only reply as no reply but still returns its text", () => {
    const outcome = classifyTurnEnd(observe([runEnd([assistant("   ")])]), { kind: "settled" });
    expect(outcome.status).toBe("completed");
    expect(outcome.text).toBe("   ");
    expect(outcome.hasReply).toBe(false);
  });

  it("does not fail a settled turn that never produced a snapshot", () => {
    const outcome = classifyTurnEnd(EMPTY_TURN_SNAPSHOT, { kind: "settled" });
    expect(outcome.status).toBe("completed");
    expect(outcome.hasReply).toBe(false);
    expect(outcome.stopReason).toBeNull();
  });
});

describe("classifyTurnEnd — non-settle reasons", () => {
  it("maps a deadline to timeout", () => {
    const outcome = classifyTurnEnd(EMPTY_TURN_SNAPSHOT, { kind: "timeout", deadlineMs: 5_000 });
    expect(outcome.status).toBe("timeout");
    expect(outcome.error).toContain("5000");
    expect(outcome.hasReply).toBe(false);
  });

  it("maps a destroyed session to interrupted", () => {
    const outcome = classifyTurnEnd(observe([runEnd([assistant("partial")])]), { kind: "interrupted" });
    expect(outcome.status).toBe("interrupted");
    expect(outcome.error).toBeTruthy();
    expect(outcome.hasReply).toBe(false);
  });

  it("maps an explicit failure reason to failed", () => {
    const outcome = classifyTurnEnd(EMPTY_TURN_SNAPSHOT, { kind: "failed", error: "send failed" });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("send failed");
  });
});

describe("the whole scripted turn", () => {
  it("only settles the turn on agent_settled, not on a retrying agent_end", () => {
    const events: TurnEvent[] = [
      { type: "agent_start" },
      runEnd([assistant("half", { stopReason: "error", errorMessage: "rate limited" })], { willRetry: true }),
    ];
    let reason = null as ReturnType<typeof eventTurnEndReason>;
    let snapshot = EMPTY_TURN_SNAPSHOT;
    for (const event of events) {
      snapshot = observeTurnEvent(snapshot, event);
      reason = eventTurnEndReason(event) ?? reason;
    }
    expect(reason).toBeNull();

    events.push({ type: "agent_settled" });
    for (const event of events.slice(2)) {
      snapshot = observeTurnEvent(snapshot, event);
      reason = eventTurnEndReason(event) ?? reason;
    }
    expect(reason).toEqual({ kind: "settled" });
    expect(classifyTurnEnd(snapshot, reason!).status).toBe("failed");
  });
});
