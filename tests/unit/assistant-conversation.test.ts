import { describe, expect, it } from "vitest";
import type {
  AgentMessage,
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from "@/lib/shared/types";
import {
  ASSISTANT_CONVERSATION_PAGE_SIZE,
  projectAssistantConversation,
  type AssistantConversationSession,
} from "@/lib/shared/assistant-conversation";

const DEFAULT_CWD = "/tmp/pi-work-default";

const user = (text: string): UserMessage => ({ role: "user", content: text });

const assistant = (text: string): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  model: "test-model",
  provider: "test-provider",
});

const toolResult = (toolCallId: string): ToolResultMessage => ({
  role: "toolResult",
  toolCallId,
  content: [{ type: "text", text: "ok" }],
});

function session(
  id: string,
  created: string,
  messages: AgentMessage[],
  overrides: Partial<AssistantConversationSession> = {},
): AssistantConversationSession {
  return {
    id,
    cwd: DEFAULT_CWD,
    created,
    assistant: true,
    messages,
    ...overrides,
  };
}

function texts(messages: readonly AgentMessage[]): string[] {
  return messages.map((message) => {
    if (message.role === "user") {
      return typeof message.content === "string" ? message.content : "";
    }
    if (message.role === "assistant") {
      return message.content
        .filter((block) => block.type === "text")
        .map((block) => (block as { text: string }).text)
        .join("");
    }
    return "";
  });
}

describe("projectAssistantConversation ordering", () => {
  it("orders sessions by creation time and flattens their visible messages", () => {
    const projection = projectAssistantConversation(
      [
        session("later", "2026-02-01T00:00:00.000Z", [user("third"), assistant("fourth")]),
        session("earlier", "2026-01-01T00:00:00.000Z", [
          user("first"),
          assistant("second"),
          toolResult("call-1"),
        ]),
      ],
      { defaultCwd: DEFAULT_CWD },
    );

    expect(texts(projection.messages)).toEqual(["first", "second", "third", "fourth"]);
    expect(projection.visibleCount).toBe(4);
  });

  it("ignores sessions outside the default cwd or without the assistant marker", () => {
    const projection = projectAssistantConversation(
      [
        session("kept", "2026-01-01T00:00:00.000Z", [user("kept")]),
        session("other-cwd", "2026-01-02T00:00:00.000Z", [user("other cwd")], {
          cwd: "/tmp/other",
        }),
        session("plain", "2026-01-03T00:00:00.000Z", [user("plain")], { assistant: false }),
      ],
      { defaultCwd: DEFAULT_CWD },
    );

    expect(texts(projection.messages)).toEqual(["kept"]);
  });
});

describe("projectAssistantConversation paging", () => {
  it("pages backwards across session boundaries by visible message count", () => {
    const first = Array.from({ length: 40 }, (_, index) => user(`a${index}`));
    const second = Array.from({ length: 40 }, (_, index) => assistant(`b${index}`));
    const third = Array.from({ length: 40 }, (_, index) => user(`c${index}`));
    const projection = projectAssistantConversation(
      [
        session("third", "2026-03-01T00:00:00.000Z", third),
        session("first", "2026-01-01T00:00:00.000Z", first),
        session("second", "2026-02-01T00:00:00.000Z", second),
      ],
      { defaultCwd: DEFAULT_CWD },
    );

    expect(projection.visibleCount).toBe(120);
    expect(projection.pageSize).toBe(ASSISTANT_CONVERSATION_PAGE_SIZE);

    const latest = projection.pageFromEnd(0);
    expect(texts(latest.messages)[0]).toBe("b30");
    expect(latest.messages).toHaveLength(50);
    expect(latest.start).toBe(70);
    expect(latest.hasMore).toBe(true);

    const previous = projection.pageBefore(latest.start);
    expect(previous.messages).toHaveLength(50);
    expect(previous.start).toBe(20);
    expect(previous.hasMore).toBe(true);
    expect(texts(previous.messages)[0]).toBe("a20");
    expect(texts(previous.messages).at(-1)).toBe("b29");

    const oldest = projection.pageBefore(previous.start);
    expect(oldest.messages).toHaveLength(20);
    expect(oldest.start).toBe(0);
    expect(oldest.hasMore).toBe(false);
    expect(texts(oldest.messages)[0]).toBe("a0");
    expect(texts(oldest.messages).at(-1)).toBe("a19");

    expect([
      ...texts(oldest.messages),
      ...texts(previous.messages),
      ...texts(latest.messages),
    ]).toEqual(texts(projection.messages));
  });
});

describe("projectAssistantConversation degenerate inputs", () => {
  it("returns the whole conversation as one page for a single short session", () => {
    const projection = projectAssistantConversation(
      [
        session(
          "only",
          "2026-01-01T00:00:00.000Z",
          Array.from({ length: 10 }, (_, index) => user(`m${index}`)),
        ),
      ],
      { defaultCwd: DEFAULT_CWD },
    );

    expect(projection.latestPageStart).toBe(0);
    const page = projection.pageFromEnd(0);
    expect(page.messages).toHaveLength(10);
    expect(page.start).toBe(0);
    expect(page.hasMore).toBe(false);

    const before = projection.pageBefore(0);
    expect(before.messages).toEqual([]);
    expect(before.start).toBe(0);
    expect(before.hasMore).toBe(false);
  });

  it("returns an empty latest page for an empty conversation", () => {
    const projection = projectAssistantConversation([], { defaultCwd: DEFAULT_CWD });

    expect(projection.visibleCount).toBe(0);
    expect(projection.latestPageStart).toBe(0);

    const page = projection.pageFromEnd(0);
    expect(page.messages).toEqual([]);
    expect(page.start).toBe(0);
    expect(page.hasMore).toBe(false);
  });
});
