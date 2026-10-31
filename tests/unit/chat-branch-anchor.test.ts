import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { branchAnchorEntryId } from "@/lib/shared/chat-timeline";
import { buildSessionContext } from "@/lib/server/sessions/reader";
import type { AgentMessage, AssistantMessage, ToolResultMessage, UserMessage } from "@/lib/shared/types";

const user = (text: string, timestamp = 1): UserMessage => ({ role: "user", content: text, timestamp });

const assistant = (blocks: AssistantMessage["content"], timestamp = 2): AssistantMessage => ({
  role: "assistant",
  content: blocks,
  model: "test-model",
  provider: "test-provider",
  timestamp,
});

const toolCall = (toolCallId: string) =>
  ({ type: "toolCall" as const, toolCallId, toolName: "read", input: { path: "/tmp/a.ts" } });

const toolResult = (toolCallId: string, timestamp = 3): ToolResultMessage => ({
  role: "toolResult",
  toolCallId,
  toolName: "read",
  content: [{ type: "text", text: "ok" }],
  timestamp,
});

const text = (text: string) => ({ type: "text" as const, text });

function anchors(messages: AgentMessage[], entryIds: string[]): (string | null)[] {
  return messages.map((_, index) => branchAnchorEntryId(messages, entryIds, index));
}

describe("branchAnchorEntryId", () => {
  it("anchors a user message on the assistant message before it", () => {
    const messages = [user("one"), assistant([text("answer")]), user("two")];
    expect(anchors(messages, ["e1", "e2", "e3"])).toEqual([null, null, "e2"]);
  });

  it("anchors on the pending tool result when the turn ended with one", () => {
    const messages = [user("one"), assistant([toolCall("call-1")]), toolResult("call-1"), user("two")];
    expect(anchors(messages, ["e1", "e2", "e3", "e4"])[3]).toBe("e3");
  });

  it("skips trailing rows the session file has not accepted yet", () => {
    const messages = [user("one"), assistant([text("answer")]), user("two"), user("three")];
    expect(anchors(messages, ["e1", "e2"])[3]).toBe("e2");
  });

  it("has no anchor for the first row or for non-user rows", () => {
    const messages = [user("one"), assistant([text("answer")])];
    expect(anchors(messages, ["e1", "e2"])).toEqual([null, null]);
  });
});

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function entryLine(id: string, parentId: string | null, message: unknown): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp: new Date(1700000000000).toISOString(),
    message,
  }) + "\n";
}

function readContext(lines: string[]) {
  const root = mkdtempSync(path.join(tmpdir(), "pi-work-branch-anchor-"));
  created.push(root);
  const dir = path.join(root, "sessions", "--tmp-project--");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "s.jsonl");
  writeFileSync(
    filePath,
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "s-branch",
        timestamp: new Date(1700000000000).toISOString(),
        cwd: "/tmp/project",
      }) + "\n",
      ...lines,
    ].join(""),
    "utf8",
  );
  const sm = SessionManager.open(filePath);
  return buildSessionContext(sm.getEntries() as never, sm.getLeafId());
}

describe("branch anchor on a real session transcript", () => {
  it("keeps offering a branch on the message that follows an interrupted turn", () => {
    const ctx = readContext([
      entryLine("u1", null, { role: "user", content: [text("第一句")], timestamp: 1700000000000 }),
      entryLine("a1", "u1", {
        role: "assistant",
        content: [{ type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "/tmp/a.ts" } }],
        model: "m",
        provider: "p",
        stopReason: "toolUse",
        timestamp: 1700000001000,
      }),
      entryLine("tr1", "a1", {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [text("aborted")],
        timestamp: 1700000002000,
      }),
      entryLine("u2", "tr1", { role: "user", content: [text("换一种做法")], timestamp: 1700000003000 }),
    ]);

    const last = ctx.messages.length - 1;
    expect(ctx.messages[last].role).toBe("user");
    expect(branchAnchorEntryId(ctx.messages, ctx.entryIds, last)).toBe("tr1");
  });
});
