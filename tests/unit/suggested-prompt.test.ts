import { describe, expect, it } from "vitest";
import type {
  AgentMessage,
  AssistantContentBlock,
  SessionEntry,
  TextContent,
} from "@/lib/shared/types";
import {
  cleanSuggestion,
  decideNormalEnd,
  decideSuggestedPromptEligibility,
  decideSuggestedPromptTab,
  extractSuggestedPromptContext,
  resolveActivePath,
  type SuggestedPromptEligibilityInput,
} from "@/lib/shared/suggested-prompt";

describe("decideSuggestedPromptEligibility", () => {
  const base: SuggestedPromptEligibilityInput = {
    isSubagentChildSession: false,
    isScheduledSession: false,
  };
  const decide = (overrides: Partial<SuggestedPromptEligibilityInput> = {}) =>
    decideSuggestedPromptEligibility({ ...base, ...overrides });

  it("allows a user-interactive session", () => {
    expect(decide()).toEqual({ kind: "proceed" });
  });

  it("refuses a subagent child session", () => {
    expect(decide({ isSubagentChildSession: true })).toEqual({
      kind: "abandon",
      reason: "subagent-session",
    });
  });

  it("refuses a scheduled session", () => {
    expect(decide({ isScheduledSession: true })).toEqual({
      kind: "abandon",
      reason: "scheduled-session",
    });
  });

  it("refuses a session that is both, reporting the subagent identity first", () => {
    expect(decide({ isSubagentChildSession: true, isScheduledSession: true })).toEqual({
      kind: "abandon",
      reason: "subagent-session",
    });
  });
});

describe("decideSuggestedPromptTab", () => {
  it("adopts the suggestion into an empty input", () => {
    expect(decideSuggestedPromptTab({ inputText: "", suggestion: "那错误处理呢？" })).toEqual({
      kind: "adopt",
      text: "那错误处理呢？",
    });
  });

  it("treats a whitespace-only input as empty", () => {
    expect(decideSuggestedPromptTab({ inputText: " \n\t ", suggestion: "那错误处理呢？" })).toEqual({
      kind: "adopt",
      text: "那错误处理呢？",
    });
  });

  it("does nothing once the user has typed", () => {
    expect(decideSuggestedPromptTab({ inputText: "那错误", suggestion: "那错误处理呢？" })).toEqual({
      kind: "none",
    });
  });

  it("does nothing without a suggestion", () => {
    expect(decideSuggestedPromptTab({ inputText: "", suggestion: null })).toEqual({ kind: "none" });
    expect(decideSuggestedPromptTab({ inputText: "", suggestion: undefined })).toEqual({ kind: "none" });
    expect(decideSuggestedPromptTab({ inputText: "", suggestion: "   " })).toEqual({ kind: "none" });
  });
});

describe("cleanSuggestion", () => {
  it("keeps a plain question as-is", () => {
    expect(cleanSuggestion("那错误处理呢？")).toEqual({
      kind: "use",
      suggestion: "那错误处理呢？",
    });
  });

  it("strips surrounding quotes of any flavour", () => {
    expect(cleanSuggestion('  "How about concurrency?"  ')).toEqual({
      kind: "use",
      suggestion: "How about concurrency?",
    });
    expect(cleanSuggestion("「那错误处理呢？」")).toEqual({
      kind: "use",
      suggestion: "那错误处理呢？",
    });
    expect(cleanSuggestion("‘那错误处理呢？’")).toEqual({
      kind: "use",
      suggestion: "那错误处理呢？",
    });
  });

  it("strips markdown decorations", () => {
    expect(cleanSuggestion("**那错误处理呢？**")).toEqual({
      kind: "use",
      suggestion: "那错误处理呢？",
    });
    expect(cleanSuggestion("`那错误处理呢？`")).toEqual({
      kind: "use",
      suggestion: "那错误处理呢？",
    });
    expect(cleanSuggestion("- 那错误处理呢？")).toEqual({
      kind: "use",
      suggestion: "那错误处理呢？",
    });
    expect(cleanSuggestion("## 那错误处理呢？")).toEqual({
      kind: "use",
      suggestion: "那错误处理呢？",
    });
  });

  it("collapses internal whitespace and newlines", () => {
    expect(cleanSuggestion("  那错误\n处理\t呢？  ")).toEqual({
      kind: "use",
      suggestion: "那错误 处理 呢？",
    });
  });

  it("keeps a trailing question mark", () => {
    expect(cleanSuggestion('"How about concurrency?"')).toEqual({
      kind: "use",
      suggestion: "How about concurrency?",
    });
  });

  it("reports an empty suggestion when nothing survives cleanup", () => {
    expect(cleanSuggestion(null)).toEqual({ kind: "abandon", reason: "empty-suggestion" });
    expect(cleanSuggestion(undefined)).toEqual({ kind: "abandon", reason: "empty-suggestion" });
    expect(cleanSuggestion("")).toEqual({ kind: "abandon", reason: "empty-suggestion" });
    expect(cleanSuggestion("   \n\t ")).toEqual({ kind: "abandon", reason: "empty-suggestion" });
    expect(cleanSuggestion('""')).toEqual({ kind: "abandon", reason: "empty-suggestion" });
    expect(cleanSuggestion("**")).toEqual({ kind: "abandon", reason: "empty-suggestion" });
  });

  it("accepts a suggestion of exactly 150 characters", () => {
    const atLimit = "问".repeat(150);
    expect(cleanSuggestion(atLimit)).toEqual({ kind: "use", suggestion: atLimit });
    expect(cleanSuggestion(`"${atLimit}"`)).toEqual({ kind: "use", suggestion: atLimit });
  });

  it("discards the whole suggestion when it exceeds 150 characters", () => {
    expect(cleanSuggestion("问".repeat(151))).toEqual({
      kind: "abandon",
      reason: "suggestion-too-long",
    });
    expect(cleanSuggestion(`"${"问".repeat(151)}"`)).toEqual({
      kind: "abandon",
      reason: "suggestion-too-long",
    });
  });

  it("counts characters by code point, not UTF-16 unit", () => {
    const emoji = "🙂".repeat(150);
    expect(cleanSuggestion(emoji)).toEqual({ kind: "use", suggestion: emoji });
    expect(cleanSuggestion("🙂".repeat(151))).toEqual({
      kind: "abandon",
      reason: "suggestion-too-long",
    });
  });
});

const timestamp = "2026-01-01T00:00:00.000Z";
const textBlock = (text: string): TextContent => ({ type: "text", text });
const toolCallBlock: AssistantContentBlock = {
  type: "toolCall",
  toolCallId: "call-1",
  toolName: "read_file",
  input: { path: "a.ts" },
};

function userEntry(id: string, parentId: string | null, text: string): SessionEntry {
  const message: AgentMessage = { role: "user", content: [textBlock(text)] };
  return { type: "message", id, parentId, timestamp, message };
}

function assistantEntry(
  id: string,
  parentId: string | null,
  text: string,
  stopReason?: string,
): SessionEntry {
  const content: AssistantContentBlock[] = text ? [textBlock(text)] : [toolCallBlock];
  const message: AgentMessage = {
    role: "assistant",
    content,
    model: "test-model",
    provider: "test-provider",
    stopReason,
  };
  return { type: "message", id, parentId, timestamp, message };
}

function toolResultEntry(id: string, parentId: string | null, text: string): SessionEntry {
  const message: AgentMessage = {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "read_file",
    content: [textBlock(text)],
  };
  return { type: "message", id, parentId, timestamp, message };
}

function compactionEntry(id: string, parentId: string | null, summary: string): SessionEntry {
  return { type: "compaction", id, parentId, timestamp, summary, firstKeptEntryId: id, tokensBefore: 100 };
}

function labelEntry(id: string, parentId: string | null): SessionEntry {
  return { type: "label", id, parentId, timestamp, targetId: "u1", label: "start" };
}

describe("resolveActivePath", () => {
  const root = userEntry("u1", null, "Add retries");
  const interim = assistantEntry("a1", "u1", "", "toolUse");
  const abandoned = assistantEntry("a-abandoned", "a1", "Giving up on retries", "stop");
  const kept = assistantEntry("a2", "a1", "Retries are added", "stop");
  const followUp = userEntry("u2", "a2", "What about backoff?");
  const entries = [root, interim, abandoned, kept, followUp];

  it("walks parent links from the active leaf back to the root", () => {
    expect(resolveActivePath(entries, "u2")).toEqual([root, interim, kept, followUp]);
  });

  it("drops messages that live on an abandoned branch", () => {
    const path = resolveActivePath(entries, "u2");
    expect(path.map((entry) => entry.id)).not.toContain("a-abandoned");
  });

  it("falls back to the last entry of the stream without a leaf id", () => {
    expect(resolveActivePath(entries, null)).toEqual([root, interim, kept, followUp]);
    expect(resolveActivePath(entries, undefined)).toEqual([root, interim, kept, followUp]);
  });

  it("returns an empty path for an unknown leaf", () => {
    expect(resolveActivePath(entries, "missing")).toEqual([]);
  });
});

describe("decideNormalEnd", () => {
  const turn = (stopReason: string | undefined, text = "Here is the answer") => [
    userEntry("u1", null, "Do the thing"),
    assistantEntry("a1", "u1", "", "toolUse"),
    assistantEntry("a2", "a1", text, stopReason),
  ];

  it("proceeds when the last assistant message stopped normally with text", () => {
    expect(decideNormalEnd(turn("stop"))).toEqual({ kind: "proceed" });
  });

  it.each(["length", "deferred", "aborted", "error", "toolUse", "pending", undefined])(
    "abandons a turn whose last assistant message ended with %s",
    (stopReason) => {
      expect(decideNormalEnd(turn(stopReason))).toEqual({
        kind: "abandon",
        reason: "turn-not-complete",
      });
    },
  );

  it("abandons a normally stopped turn without any text", () => {
    expect(decideNormalEnd(turn("stop", ""))).toEqual({
      kind: "abandon",
      reason: "empty-assistant-text",
    });
    expect(decideNormalEnd(turn("stop", "   \n "))).toEqual({
      kind: "abandon",
      reason: "empty-assistant-text",
    });
  });

  it("abandons a path without any assistant message", () => {
    expect(decideNormalEnd([userEntry("u1", null, "Do the thing")])).toEqual({
      kind: "abandon",
      reason: "no-assistant-message",
    });
    expect(decideNormalEnd([])).toEqual({ kind: "abandon", reason: "no-assistant-message" });
  });

  it("ignores trailing non-message entries", () => {
    expect(decideNormalEnd([...turn("stop"), labelEntry("l1", "a2")])).toEqual({ kind: "proceed" });
  });
});

describe("extractSuggestedPromptContext", () => {
  it("keeps every user message and only the final assistant answer of each round", () => {
    const path = [
      userEntry("u1", null, "Add retries"),
      assistantEntry("a1", "u1", "Looking at the retry helper", "toolUse"),
      toolResultEntry("t1", "a1", "file contents"),
      assistantEntry("a2", "t1", "Retries are added", "stop"),
      userEntry("u2", "a2", "What about backoff?"),
      assistantEntry("a3", "u2", "Backoff is added", "stop"),
    ];

    expect(extractSuggestedPromptContext(path)).toEqual([
      { role: "user", text: "Add retries" },
      { role: "assistant", text: "Retries are added" },
      { role: "user", text: "What about backoff?" },
      { role: "assistant", text: "Backoff is added" },
    ]);
  });

  it("drops assistant rounds that did not end normally", () => {
    const path = [
      userEntry("u1", null, "Add retries"),
      assistantEntry("a1", "u1", "Half an answer", "length"),
    ];
    expect(extractSuggestedPromptContext(path)).toEqual([{ role: "user", text: "Add retries" }]);
  });

  it("drops empty text blocks from both sides", () => {
    const path = [
      userEntry("u1", null, "   "),
      assistantEntry("a1", "u1", "   ", "stop"),
      userEntry("u2", "a1", "Still there?"),
      assistantEntry("a2", "u2", "Yes", "stop"),
    ];
    expect(extractSuggestedPromptContext(path)).toEqual([
      { role: "user", text: "Still there?" },
      { role: "assistant", text: "Yes" },
    ]);
  });

  it("accepts user messages whose content is a plain string", () => {
    const plain: SessionEntry = {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp,
      message: { role: "user", content: "Plain string prompt" },
    };
    expect(extractSuggestedPromptContext([plain])).toEqual([
      { role: "user", text: "Plain string prompt" },
    ]);
  });

  it("joins multiple text blocks of one message", () => {
    const multi: SessionEntry = {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp,
      message: { role: "user", content: [textBlock("first"), textBlock("second")] },
    };
    expect(extractSuggestedPromptContext([multi])).toEqual([
      { role: "user", text: "first\nsecond" },
    ]);
  });

  it("ignores compaction summaries and other non-message entries", () => {
    const path = [
      userEntry("u1", null, "Add retries"),
      assistantEntry("a1", "u1", "Retries are added", "stop"),
      compactionEntry("c1", "a1", "Earlier the user asked for retries"),
      userEntry("u2", "c1", "What about backoff?"),
      assistantEntry("a2", "u2", "Backoff is added", "stop"),
      labelEntry("l1", "a2"),
    ];
    expect(extractSuggestedPromptContext(path)).toEqual([
      { role: "user", text: "Add retries" },
      { role: "assistant", text: "Retries are added" },
      { role: "user", text: "What about backoff?" },
      { role: "assistant", text: "Backoff is added" },
    ]);
  });

  it("does not truncate long input", () => {
    const long = "x".repeat(5000);
    expect(extractSuggestedPromptContext([userEntry("u1", null, long)])).toEqual([
      { role: "user", text: long },
    ]);
  });

  it("keeps abandoned branches out of the context", () => {
    const root = userEntry("u1", null, "Add retries");
    const interim = assistantEntry("a1", "u1", "", "toolUse");
    const kept = assistantEntry("a2", "a1", "Retries are added", "stop");
    const abandoned = assistantEntry("a-abandoned", "a1", "Giving up on retries", "stop");
    const entries = [root, interim, abandoned, kept];
    expect(extractSuggestedPromptContext(resolveActivePath(entries, "a2"))).toEqual([
      { role: "user", text: "Add retries" },
      { role: "assistant", text: "Retries are added" },
    ]);
  });
});
