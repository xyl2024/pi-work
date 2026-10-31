import { describe, expect, it } from "vitest";
import {
  INITIAL_SUGGESTED_PROMPT_STATE,
  decideSuggestedPromptRequest,
  reduceSuggestedPrompt,
  selectSuggestedPromptPlaceholder,
  type SuggestedPromptState,
} from "@/lib/client/suggested-prompt-state";

const sessionA = reduceSuggestedPrompt(INITIAL_SUGGESTED_PROMPT_STATE, {
  type: "session_changed",
  sessionId: "session-a",
});

const settledState: SuggestedPromptState = reduceSuggestedPrompt(
  reduceSuggestedPrompt(sessionA, { type: "request_started", sessionId: "session-a" }),
  { type: "request_settled", sessionId: "session-a", turn: 0, suggestion: "那错误处理呢？" },
);

describe("decideSuggestedPromptRequest", () => {
  it("skips when there is no session", () => {
    expect(decideSuggestedPromptRequest({ sessionId: null, requestInFlight: false })).toEqual({
      kind: "skip",
      reason: "no-session",
    });
  });

  it("skips while a request is still in flight", () => {
    expect(decideSuggestedPromptRequest({ sessionId: "s1", requestInFlight: true })).toEqual({
      kind: "skip",
      reason: "already-running",
    });
  });

  it("requests for the session when idle", () => {
    expect(decideSuggestedPromptRequest({ sessionId: "s1", requestInFlight: false })).toEqual({
      kind: "request",
      sessionId: "s1",
    });
  });
});

describe("reduceSuggestedPrompt", () => {
  it("keeps the suggestion while the user types and shows it again after clearing", () => {
    const typed = selectSuggestedPromptPlaceholder({
      suggestion: settledState.suggestion,
      inputText: "等一下",
      fallback: "static hint",
    });
    const cleared = selectSuggestedPromptPlaceholder({
      suggestion: settledState.suggestion,
      inputText: "",
      fallback: "static hint",
    });
    expect(typed).toBe("static hint");
    expect(cleared).toBe("那错误处理呢？");
  });

  it("clears the suggestion when a new turn starts but keeps the in-flight guard", () => {
    const state = reduceSuggestedPrompt(settledState, { type: "turn_started" });
    expect(state.suggestion).toBeNull();
    expect(state.turn).toBe(1);
    expect(state.inFlight).toBeNull();
  });

  it("replaces the suggestion when the new turn ends", () => {
    const state = reduceSuggestedPrompt(
      reduceSuggestedPrompt(settledState, { type: "turn_started" }),
      { type: "request_settled", sessionId: "session-a", turn: 1, suggestion: "改成并发版本？" },
    );
    expect(state.suggestion).toBe("改成并发版本？");
    expect(state.inFlight).toBeNull();
  });

  it("settles an empty suggestion to none", () => {
    const state = reduceSuggestedPrompt(
      reduceSuggestedPrompt(settledState, { type: "turn_started" }),
      { type: "request_settled", sessionId: "session-a", turn: 1, suggestion: "   " },
    );
    expect(state.suggestion).toBeNull();
  });

  it("ignores a suggestion that arrives for an older turn", () => {
    const state = reduceSuggestedPrompt(
      reduceSuggestedPrompt(settledState, { type: "turn_started" }),
      { type: "request_settled", sessionId: "session-a", turn: 0, suggestion: "过期的建议" },
    );
    expect(state.suggestion).toBeNull();
  });
});

describe("selectSuggestedPromptPlaceholder", () => {
  it("falls back to the static hint when there is no suggestion", () => {
    expect(
      selectSuggestedPromptPlaceholder({
        suggestion: INITIAL_SUGGESTED_PROMPT_STATE.suggestion,
        inputText: "",
        fallback: "static hint",
      }),
    ).toBe("static hint");
  });
});

describe("cross-session and late responses", () => {
  it("drops a late suggestion from a session the tab has since switched away from", () => {
    const started = reduceSuggestedPrompt(INITIAL_SUGGESTED_PROMPT_STATE, {
      type: "session_changed",
      sessionId: "session-a",
    });
    const inFlight = reduceSuggestedPrompt(started, {
      type: "request_started",
      sessionId: "session-a",
    });
    const switched = reduceSuggestedPrompt(inFlight, {
      type: "session_changed",
      sessionId: "session-b",
    });

    const settled = reduceSuggestedPrompt(switched, {
      type: "request_settled",
      sessionId: "session-a",
      turn: 0,
      suggestion: "旧会话的建议",
    });

    expect(settled.suggestion).toBeNull();
    expect(settled.inFlight).toBeNull();
  });

  it("drops a late suggestion for an older turn within the same session", () => {
    const started = reduceSuggestedPrompt(INITIAL_SUGGESTED_PROMPT_STATE, {
      type: "session_changed",
      sessionId: "session-a",
    });
    const inFlight = reduceSuggestedPrompt(started, {
      type: "request_started",
      sessionId: "session-a",
    });
    const nextTurn = reduceSuggestedPrompt(inFlight, { type: "turn_started" });

    const settled = reduceSuggestedPrompt(nextTurn, {
      type: "request_settled",
      sessionId: "session-a",
      turn: 0,
      suggestion: "上一轮的建议",
    });

    expect(settled.suggestion).toBeNull();
    expect(settled.turn).toBe(1);
  });

  it("keeps showing the suggestion of the session it was generated for", () => {
    const started = reduceSuggestedPrompt(INITIAL_SUGGESTED_PROMPT_STATE, {
      type: "session_changed",
      sessionId: "session-a",
    });
    const settled = reduceSuggestedPrompt(
      reduceSuggestedPrompt(started, { type: "request_started", sessionId: "session-a" }),
      { type: "request_settled", sessionId: "session-a", turn: 0, suggestion: "那错误处理呢？" },
    );

    expect(settled.suggestion).toBe("那错误处理呢？");
  });
});
