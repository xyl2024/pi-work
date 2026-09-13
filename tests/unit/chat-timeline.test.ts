import { describe, expect, it } from "vitest";
import type { AgentMessage, AssistantMessage, ToolResultMessage, UserMessage } from "@/lib/shared/types";
import {
  buildChatTimeline,
  decideSearchJump,
  indexToolResults,
  isVisibleChatMessage,
} from "@/lib/shared/chat-timeline";

const user = (text: string): UserMessage => ({ role: "user", content: text });

const assistant = (blocks: AssistantMessage["content"]): AssistantMessage => ({
  role: "assistant",
  content: blocks,
  model: "test-model",
  provider: "test-provider",
});

const toolCall = (toolCallId: string) =>
  ({ type: "toolCall" as const, toolCallId, toolName: "read", input: { path: "/tmp/a.ts" } });

const toolResult = (toolCallId: string): ToolResultMessage => ({
  role: "toolResult",
  toolCallId,
  content: [{ type: "text", text: "ok" }],
});

function timelineOf(messages: AgentMessage[], entryIds?: string[]) {
  return buildChatTimeline({
    messages,
    entryIds: entryIds ?? messages.map((_, i) => `entry-${i}`),
    entryTimestamps: messages.map((_, i) => 1000 + i),
  });
}

describe("isVisibleChatMessage", () => {
  it("keeps user and assistant messages", () => {
    expect(isVisibleChatMessage(user("hi"))).toBe(true);
    expect(isVisibleChatMessage(assistant([{ type: "text", text: "hello" }]))).toBe(true);
  });

  it("drops tool results and custom messages", () => {
    expect(isVisibleChatMessage(toolResult("call-1"))).toBe(false);
    expect(
      isVisibleChatMessage({ role: "custom", customType: "note", content: "x", display: false }),
    ).toBe(false);
  });
});

describe("buildChatTimeline visible messages", () => {
  it("keeps only user / assistant rows, in session order", () => {
    const messages: AgentMessage[] = [
      user("one"),
      assistant([toolCall("call-1")]),
      toolResult("call-1"),
      user("two"),
    ];
    const timeline = timelineOf(messages);
    expect(timeline.visibleCount).toBe(3);
    expect(timeline.visibleMessages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(timeline.visibleMessages[0]).toBe(messages[0]);
    expect(timeline.visibleMessages[1]).toBe(messages[1]);
    expect(timeline.visibleMessages[2]).toBe(messages[3]);
  });

  it("is empty for an empty conversation", () => {
    const timeline = timelineOf([]);
    expect(timeline.visibleCount).toBe(0);
    expect(timeline.visibleMessages).toEqual([]);
  });
});

describe("buildChatTimeline session ↔ visible index", () => {
  const messages: AgentMessage[] = [
    user("one"), // session 0 → visible 0
    assistant([toolCall("call-1")]), // session 1 → visible 1
    toolResult("call-1"), // session 2 → invisible
    user("two"), // session 3 → visible 2
  ];

  it("maps session indices forward", () => {
    const timeline = timelineOf(messages);
    expect(timeline.visibleIndexOfSession(0)).toBe(0);
    expect(timeline.visibleIndexOfSession(1)).toBe(1);
    expect(timeline.visibleIndexOfSession(3)).toBe(2);
  });

  it("resolves an invisible session entry to the following visible message", () => {
    const timeline = timelineOf(messages);
    expect(timeline.visibleIndexOfSession(2)).toBe(2);
  });

  it("clamps session indices at or past the end", () => {
    const timeline = timelineOf(messages);
    expect(timeline.visibleIndexOfSession(4)).toBe(3);
    expect(timeline.visibleIndexOfSession(99)).toBe(3);
    expect(timeline.visibleIndexOfSession(-1)).toBe(0);
  });

  it("maps visible indices back to session indices", () => {
    const timeline = timelineOf(messages);
    expect(timeline.sessionIndexOfVisible(0)).toBe(0);
    expect(timeline.sessionIndexOfVisible(1)).toBe(1);
    expect(timeline.sessionIndexOfVisible(2)).toBe(3);
    expect(timeline.sessionIndexOfVisible(3)).toBeNull();
    expect(timeline.sessionIndexOfVisible(-1)).toBeNull();
  });

  it("round-trips a visible session index through both directions", () => {
    const timeline = timelineOf(messages);
    for (const visibleIndex of [0, 1, 2]) {
      const sessionIndex = timeline.sessionIndexOfVisible(visibleIndex);
      expect(sessionIndex).not.toBeNull();
      expect(timeline.visibleIndexOfSession(sessionIndex as number)).toBe(visibleIndex);
    }
  });

  it("resolves an entry id to its visible index, and unknown ids to null", () => {
    const timeline = timelineOf(messages, ["e0", "e1", "e2", "e3"]);
    expect(timeline.visibleIndexOfEntry("e0")).toBe(0);
    expect(timeline.visibleIndexOfEntry("e2")).toBe(2); // tool result → next visible
    expect(timeline.visibleIndexOfEntry("e3")).toBe(2);
    expect(timeline.visibleIndexOfEntry("missing")).toBeNull();
  });
});

describe("buildChatTimeline tool call mapping", () => {
  it("maps each tool call id to the visible index of its assistant message", () => {
    const messages: AgentMessage[] = [
      user("one"),
      assistant([toolCall("call-a"), { type: "text", text: "then" }, toolCall("call-b")]),
      toolResult("call-a"),
      user("two"),
      assistant([toolCall("call-c")]),
    ];
    const timeline = timelineOf(messages);
    expect(timeline.toolCallVisibleIndices.get("call-a")).toBe(1);
    expect(timeline.toolCallVisibleIndices.get("call-b")).toBe(1);
    expect(timeline.toolCallVisibleIndices.get("call-c")).toBe(3);
    expect(timeline.toolCallVisibleIndices.get("unknown")).toBeUndefined();
  });

  it("ignores tool calls on non-assistant messages", () => {
    const timeline = timelineOf([user("one"), toolResult("call-a")]);
    expect(timeline.toolCallVisibleIndices.size).toBe(0);
  });
});

describe("buildChatTimeline replay crop", () => {
  const messages: AgentMessage[] = [
    user("one"),
    assistant([toolCall("call-a")]),
    toolResult("call-a"),
    user("two"),
  ];
  const entryIds = ["e0", "e1", "e2", "e3"];
  const entryTimestamps = [10, 11, 12, 13];
  const timeline = buildChatTimeline({ messages, entryIds, entryTimestamps });

  it("keeps the whole conversation when replay is closed", () => {
    const slice = timeline.sliceForReplay(null);
    expect(slice.messages).toHaveLength(4);
    expect(slice.entryIds).toEqual(entryIds);
    expect(slice.entryTimestamps).toEqual(entryTimestamps);
  });

  it("crops at index 0 to nothing", () => {
    const slice = timeline.sliceForReplay(0);
    expect(slice.messages).toEqual([]);
    expect(slice.entryIds).toEqual([]);
    expect(slice.entryTimestamps).toEqual([]);
  });

  it("crops in the middle on all three parallel arrays", () => {
    const slice = timeline.sliceForReplay(2);
    expect(slice.messages).toEqual(messages.slice(0, 2));
    expect(slice.entryIds).toEqual(["e0", "e1"]);
    expect(slice.entryTimestamps).toEqual([10, 11]);
  });

  it("keeps everything at exactly the total", () => {
    expect(timeline.sliceForReplay(4).messages).toEqual(messages);
  });

  it("clamps past the total", () => {
    expect(timeline.sliceForReplay(9).messages).toEqual(messages);
  });

  it("still pairs a call with a result sitting past the crop", () => {
    const slice = timeline.sliceForReplay(2); // tool result at index 2 is cropped out
    expect(slice.messages.some((m) => m.role === "toolResult")).toBe(false);
    // Pairing is built from the full conversation, so the result is still there.
    expect(timeline.toolCallVisibleIndices.get("call-a")).toBe(1);
    expect(indexToolResults(messages).get("call-a")).toBe(messages[2]);
  });
});

describe("indexToolResults", () => {
  it("keeps the last result for a repeated tool call id", () => {
    const messages: AgentMessage[] = [toolResult("call-a"), toolResult("call-a")];
    const map = indexToolResults(messages);
    expect(map.size).toBe(1);
    expect(map.get("call-a")).toBe(messages[1]);
  });

  it("ignores non-tool-result messages", () => {
    expect(indexToolResults([user("one"), assistant([toolCall("call-a")])]).size).toBe(0);
  });
});

describe("decideSearchJump", () => {
  const messages: AgentMessage[] = [
    user("one"),
    assistant([toolCall("call-a")]),
    toolResult("call-a"),
    user("two"),
  ];
  const timeline = timelineOf(messages, ["e0", "e1", "e2", "e3"]);

  it("skips when nothing is pending", () => {
    expect(decideSearchJump(timeline, null)).toEqual({ kind: "skip" });
  });

  it("skips an entry this timeline does not know", () => {
    expect(decideSearchJump(timeline, "missing")).toEqual({ kind: "skip" });
  });

  it("resolves a matched entry to its visible index", () => {
    expect(decideSearchJump(timeline, "e3")).toEqual({
      kind: "jump",
      entryId: "e3",
      visibleIndex: 2,
    });
  });

  it("resolves a matched invisible entry to the following visible message", () => {
    expect(decideSearchJump(timeline, "e2")).toEqual({
      kind: "jump",
      entryId: "e2",
      visibleIndex: 2,
    });
  });
});
