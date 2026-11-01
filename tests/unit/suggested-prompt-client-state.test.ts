import { describe, expect, it } from "vitest";
import {
  decideSuggestedPromptFetch,
  selectSuggestionText,
  selectSuggestedPromptPlaceholder,
  type SuggestedPromptLeafText,
} from "@/lib/client/suggested-prompt-state";

const fetched = (leafId: string, text: string): SuggestedPromptLeafText => ({ leafId, text });

describe("decideSuggestedPromptFetch", () => {
  it("skips without a session", () => {
    expect(decideSuggestedPromptFetch({ sessionId: null, leafId: "a1", busy: false })).toEqual({
      kind: "skip",
      reason: "no-session",
    });
  });

  it("skips without a leaf", () => {
    expect(decideSuggestedPromptFetch({ sessionId: "s1", leafId: null, busy: false })).toEqual({
      kind: "skip",
      reason: "no-leaf",
    });
  });

  it("waits for the turn to settle", () => {
    expect(decideSuggestedPromptFetch({ sessionId: "s1", leafId: "a1", busy: true })).toEqual({
      kind: "skip",
      reason: "turn-running",
    });
  });

  it("fetches for the current session and leaf", () => {
    expect(decideSuggestedPromptFetch({ sessionId: "s1", leafId: "a1", busy: false })).toEqual({
      kind: "fetch",
      sessionId: "s1",
      leafId: "a1",
    });
  });
});

describe("selectSuggestionText", () => {
  const base = { leafId: "a1", fetched: null, pushed: null, suppressedLeafId: null };

  it("returns nothing without a leaf", () => {
    expect(selectSuggestionText({ ...base, leafId: null, fetched: fetched("a1", "x") })).toBeNull();
  });

  it("prefers the pushed suggestion for the same leaf", () => {
    expect(
      selectSuggestionText({
        ...base,
        fetched: fetched("a1", "旧的"),
        pushed: fetched("a1", "新的"),
      }),
    ).toBe("新的");
  });

  it("ignores a suggestion belonging to another leaf", () => {
    expect(selectSuggestionText({ ...base, pushed: fetched("a2", "别的分支") })).toBeNull();
  });

  it("hides the suggestion once a turn starts on that leaf", () => {
    expect(
      selectSuggestionText({
        ...base,
        pushed: fetched("a1", "那错误处理呢？"),
        suppressedLeafId: "a1",
      }),
    ).toBeNull();
  });

  it("shows the suggestion again when the leaf moves on", () => {
    expect(
      selectSuggestionText({
        ...base,
        leafId: "a2",
        pushed: fetched("a2", "那错误处理呢？"),
        suppressedLeafId: "a1",
      }),
    ).toBe("那错误处理呢？");
  });
});

describe("selectSuggestedPromptPlaceholder", () => {
  it("adopts the suggestion into an empty input", () => {
    expect(
      selectSuggestedPromptPlaceholder({ inputText: "", suggestion: "那错误处理呢？", fallback: "问点什么" }),
    ).toBe("那错误处理呢？");
  });

  it("keeps the fallback while the user is typing", () => {
    expect(
      selectSuggestedPromptPlaceholder({ inputText: "我在写", suggestion: "那错误处理呢？", fallback: "问点什么" }),
    ).toBe("问点什么");
  });
});
