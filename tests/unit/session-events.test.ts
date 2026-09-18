import { describe, expect, it } from "vitest";
import {
  IGNORED_SESSION_EVENTS,
  PORTED_SESSION_EVENT_TYPES,
  REDUCED_SESSION_EVENTS,
  SESSION_EVENT_TYPES,
  isPortedSessionEvent,
  reduceSessionEvent,
} from "@/lib/shared/session-events";
import type { PortedSessionEvent, SessionEvent } from "@/lib/shared/session-events";
import {
  createSessionRuntimeState,
  patchSessionRuntimeState,
} from "@/lib/shared/session-runtime-state";

// Pure unit tests for the session-event protocol (#58). The module is types +
// constants only, so this file checks the one runtime property the compile
// time checks cannot: that the two disposition lists and the enumerable type
// list agree with each other. If any of them drifts, the client would claim to
// have an opinion about an event it does not know, or silently ignore one it
// never decided about.

const reducedTypes = Object.keys(REDUCED_SESSION_EVENTS);
const ignoredTypes = Object.keys(IGNORED_SESSION_EVENTS);
const allTypes: readonly string[] = SESSION_EVENT_TYPES;

describe("session event protocol", () => {
  it("lists every protocol type exactly once", () => {
    expect(new Set(allTypes).size).toBe(allTypes.length);
    expect(allTypes.length).toBeGreaterThan(0);
  });

  it("partitions the protocol into reduced and deliberately-ignored", () => {
    expect(new Set([...reducedTypes, ...ignoredTypes])).toEqual(new Set(allTypes));
  });

  it("keeps the two lists disjoint", () => {
    const overlap = reducedTypes.filter((type) => ignoredTypes.includes(type));
    expect(overlap).toEqual([]);
  });

  it("does not put an extra member in the deliberately-ignored list", () => {
    expect(ignoredTypes.filter((type) => !allTypes.includes(type))).toEqual([]);
  });

  it("does not put a reduced branch outside the protocol", () => {
    expect(reducedTypes.filter((type) => !allTypes.includes(type))).toEqual([]);
  });

  it("gives every deliberately-ignored event a written reason", () => {
    expect(ignoredTypes.length).toBeGreaterThan(0);
    for (const type of ignoredTypes) {
      expect(IGNORED_SESSION_EVENTS[type as keyof typeof IGNORED_SESSION_EVENTS].trim().length)
        .toBeGreaterThan(0);
    }
  });

  it("gives every reduced branch a note", () => {
    expect(reducedTypes.length).toBeGreaterThan(0);
    for (const type of reducedTypes) {
      expect(REDUCED_SESSION_EVENTS[type as keyof typeof REDUCED_SESSION_EVENTS].trim().length)
        .toBeGreaterThan(0);
    }
  });
});

// ── The reducer (#60) ────────────────────────────────────────────────────
//
// The first slice of the port sends two real paths through the pure reducer:
// the dangerous-command confirmation and the ask-user-questions card. These
// tests assert the contract the adapter relies on — state transition plus the
// effects to perform — with no React, DOM or store involved.

const permissionEvent = {
  type: "permission_request",
  toolCallId: "call-1",
  ruleName: "rm",
  command: "rm -rf /tmp/x",
} satisfies PortedSessionEvent;

function askEvent(toolCallId: string, ts = 1_700_000_000_000): Extract<PortedSessionEvent, { type: "ask_user_questions_request" }> {
  return {
    type: "ask_user_questions_request",
    toolCallId,
    ts,
    questions: [{
      question: "Which one?",
      header: "Pick",
      multiSelect: false,
      required: true,
      options: [
        { label: "A", description: "first" },
        { label: "B", description: "second" },
      ],
    }],
  };
}

/** A batch whose only question has no options — the old handler dropped it. */
const malformedAskEvent = {
  type: "ask_user_questions_request",
  toolCallId: "ask-bad",
  ts: 1,
  questions: [{ question: "no options", header: "Bad" }],
} as unknown as PortedSessionEvent;

describe("session event reducer", () => {
  it("reduces a permission request into an effect and leaves state untouched", () => {
    const state = createSessionRuntimeState();

    const reduction = reduceSessionEvent(state, permissionEvent);

    expect(reduction.state).toBe(state);
    expect(reduction.effects).toEqual([{
      kind: "enqueue_permission_request",
      toolCallId: "call-1",
      ruleName: "rm",
      command: "rm -rf /tmp/x",
    }]);
  });

  it("records an ask-user-questions request and returns its effects", () => {
    const state = createSessionRuntimeState();
    const event = askEvent("ask-1");

    const reduction = reduceSessionEvent(state, event);

    expect(reduction.state.seenAskUserQuestionsToolCallIds.has("ask-1")).toBe(true);
    expect(reduction.effects).toEqual([
      { kind: "set_pending_ask_user_questions", request: { toolCallId: "ask-1", questions: event.questions, ts: 1_700_000_000_000 } },
      { kind: "play_ui_sound", sound: "ask_user_questions" },
    ]);
  });

  it("does not ring twice when the server replays the same pending request", () => {
    const first = reduceSessionEvent(createSessionRuntimeState(), askEvent("ask-1"));

    // SSE reconnect re-emits every pending request; a replay must claim the
    // same id again and therefore ask for nothing. This is the test that pins
    // "reconnect is silent".
    const replay = reduceSessionEvent(first.state, askEvent("ask-1"));

    expect(replay.state).toBe(first.state);
    expect(replay.effects).toEqual([]);
  });

  it("rings again for a genuinely new question", () => {
    const first = reduceSessionEvent(createSessionRuntimeState(), askEvent("ask-1"));

    const second = reduceSessionEvent(first.state, askEvent("ask-2"));

    expect(second.state.seenAskUserQuestionsToolCallIds.has("ask-2")).toBe(true);
    expect(second.effects.map((effect) => effect.kind))
      .toEqual(["set_pending_ask_user_questions", "play_ui_sound"]);
  });

  it("isolates the ask-user-questions ledger per session", () => {
    const a = createSessionRuntimeState();
    const b = createSessionRuntimeState();
    reduceSessionEvent(a, askEvent("ask-1"));

    // The id already announced in session A must not suppress a first-time
    // question in session B — the ledger lives in the state, not at module
    // scope.
    expect(a.seenAskUserQuestionsToolCallIds.has("ask-1")).toBe(true);
    expect(b.seenAskUserQuestionsToolCallIds.has("ask-1")).toBe(false);
    const inB = reduceSessionEvent(b, askEvent("ask-1"));
    expect(inB.effects.map((effect) => effect.kind))
      .toEqual(["set_pending_ask_user_questions", "play_ui_sound"]);
  });

  it("drops a malformed question batch without changing state or ringing", () => {
    const state = createSessionRuntimeState();

    const reduction = reduceSessionEvent(state, malformedAskEvent);

    expect(reduction.state).toBe(state);
    expect(reduction.effects).toEqual([]);
  });

  it("leaves unrelated runtime state alone", () => {
    const state = patchSessionRuntimeState(createSessionRuntimeState(), "agentRunning", true);

    const reduction = reduceSessionEvent(state, permissionEvent);

    expect(reduction.state.agentRunning).toBe(true);
    expect(reduction.state.messages).toEqual([]);
  });

  it("routes only the ported events to the reducer", () => {
    for (const type of PORTED_SESSION_EVENT_TYPES) {
      expect(isPortedSessionEvent({ type } as SessionEvent)).toBe(true);
    }
    expect(isPortedSessionEvent({ type: "agent_start" })).toBe(false);
    expect(isPortedSessionEvent({ type: "connected", sessionId: "s" })).toBe(false);
  });
});
