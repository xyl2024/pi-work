import { describe, expect, it } from "vitest";
import {
  countAssistantBlocks,
  countContentChars,
  countImages,
  extractMessageImages,
  extractMessageText,
} from "@/lib/shared/message-content";
import type {
  AssistantMessage,
  CustomMessage,
  ImageContent,
  ToolResultMessage,
  UserMessage,
} from "@/lib/shared/types";

// ── Fixtures ──
//
// Shapes mirror what the chat message view and the conversation-tree card
// read off a real session: user content is a string or a text/image block
// array, assistant content is a block array, toolResult content is a
// text/image block array.

const image = (data: string): ImageContent => ({
  type: "image",
  source: { type: "base64", media_type: "image/png", data },
});

function userMessage(content: UserMessage["content"]): UserMessage {
  return { role: "user", content };
}

function assistantMessage(content: AssistantMessage["content"]): AssistantMessage {
  return { role: "assistant", content, model: "test-model", provider: "test-provider" };
}

function toolResultMessage(content: ToolResultMessage["content"]): ToolResultMessage {
  return { role: "toolResult", toolCallId: "call-1", content };
}

describe("extractMessageText", () => {
  it("returns a user message's string content as-is", () => {
    expect(extractMessageText(userMessage("hello world"))).toBe("hello world");
  });

  it("joins a user message's text blocks with a newline", () => {
    expect(
      extractMessageText(
        userMessage([
          { type: "text", text: "first" },
          { type: "text", text: "second" },
        ]),
      ),
    ).toBe("first\nsecond");
  });

  it("drops a user message's image blocks", () => {
    expect(
      extractMessageText(
        userMessage([
          { type: "text", text: "look at this" },
          image("AAAA"),
        ]),
      ),
    ).toBe("look at this");
  });

  it("joins an assistant message's text blocks and ignores thinking / tool calls", () => {
    expect(
      extractMessageText(
        assistantMessage([
          { type: "thinking", thinking: "hmm" },
          { type: "text", text: "let me check" },
          { type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "/tmp/x" } },
          { type: "text", text: "all good" },
          image("BBBB"),
        ]),
      ),
    ).toBe("let me check\nall good");
  });

  it("joins a toolResult message's text blocks", () => {
    expect(
      extractMessageText(
        toolResultMessage([
          { type: "text", text: "line one" },
          { type: "text", text: "line two" },
          image("CCCC"),
        ]),
      ),
    ).toBe("line one\nline two");
  });

  it("returns empty string for a message with no text blocks", () => {
    expect(extractMessageText(assistantMessage([image("DDDD")]))).toBe("");
  });

  it("handles a custom message's string and block content", () => {
    const stringCustom: CustomMessage = {
      role: "custom",
      customType: "note",
      display: true,
      content: "note text",
    };
    const blocksCustom: CustomMessage = {
      role: "custom",
      customType: "note",
      display: true,
      content: [{ type: "text", text: "a" }, { type: "text", text: "b" }],
    };
    expect(extractMessageText(stringCustom)).toBe("note text");
    expect(extractMessageText(blocksCustom)).toBe("a\nb");
  });
});

describe("extractMessageImages / countImages", () => {
  it("returns a user message's image blocks in order", () => {
    const message = userMessage([
      { type: "text", text: "see" },
      image("AAAA"),
      image("BBBB"),
    ]);
    expect(extractMessageImages(message).map((block) => block.source.data)).toEqual(["AAAA", "BBBB"]);
    expect(countImages(message)).toBe(2);
  });

  it("counts zero for a user message with string content", () => {
    expect(countImages(userMessage("just text"))).toBe(0);
  });

  it("counts an assistant message's image blocks", () => {
    const message = assistantMessage([{ type: "text", text: "here" }, image("CCCC")]);
    expect(countImages(message)).toBe(1);
  });

  it("counts a toolResult message's image blocks", () => {
    expect(countImages(toolResultMessage([image("DDDD"), image("EEEE")]))).toBe(2);
  });

  it("counts zero when there are no image blocks", () => {
    expect(countImages(assistantMessage([{ type: "text", text: "none" }]))).toBe(0);
  });
});

describe("countContentChars", () => {
  it("sums text, thinking and serialized tool-call input", () => {
    const input = { path: "/tmp/x", flag: true };
    const blocks = [
      { type: "text" as const, text: "hello" },
      { type: "thinking" as const, thinking: "abc" },
      { type: "toolCall" as const, toolCallId: "call-1", toolName: "read", input },
    ];
    expect(countContentChars(blocks)).toBe(5 + 3 + JSON.stringify(input).length);
  });

  it("counts an empty tool-call input as its serialized empty object", () => {
    expect(
      countContentChars([
        { type: "toolCall", toolCallId: "call-1", toolName: "read", input: {} },
      ]),
    ).toBe(2);
  });

  it("ignores image blocks and returns 0 for no blocks", () => {
    expect(countContentChars([image("AAAA")])).toBe(0);
    expect(countContentChars([])).toBe(0);
  });
});

describe("countAssistantBlocks", () => {
  it("counts thinking and toolCall blocks on an assistant message", () => {
    expect(
      countAssistantBlocks(
        assistantMessage([
          { type: "thinking", thinking: "a" },
          { type: "thinking", thinking: "b" },
          { type: "text", text: "answer" },
          { type: "toolCall", toolCallId: "call-1", toolName: "read", input: {} },
        ]),
      ),
    ).toEqual({ thinking: 2, toolCalls: 1 });
  });

  it("returns zeros for a non-assistant message", () => {
    expect(countAssistantBlocks(userMessage("hi"))).toEqual({ thinking: 0, toolCalls: 0 });
    expect(countAssistantBlocks(toolResultMessage([{ type: "text", text: "out" }]))).toEqual({
      thinking: 0,
      toolCalls: 0,
    });
  });
});
