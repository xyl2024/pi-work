// Seam B：消息来源的读取回环。
// 沙箱临时目录手写会话 JSONL（user message + 紧跟的 `pi_work_message_origin`
// custom entry），断言 reader 把 entry 归属到树序最近的前一条 user message：
// 无标记消息不带 origin；分支场景下 entry 随消息树脱落；非法数据按缺省处理。
// 绝不触碰真实 ~/.pi 或 ~/.pi-work 数据（先例：session-read-path.test.ts）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { MESSAGE_ORIGIN_ENTRY_TYPE, normalizeMessageOrigin } from "@/lib/shared/message-origin";
import { buildSessionContext } from "@/lib/server/sessions/reader";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sandbox(): string {
  const root = mkdtempSync(path.join(tmpdir(), "pi-work-origin-read-"));
  created.push(root);
  return root;
}

/** 首行会话文件头，与 pi 手写的形状一致。 */
function headerLine(id: string): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-02T03:04:05.000Z",
    cwd: "/tmp/project",
  }) + "\n";
}

function userEntry(id: string, parentId: string | null, text: string): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp: new Date(1700000000000).toISOString(),
    message: { role: "user", content: [{ type: "text", text }], timestamp: 1700000000000 },
  }) + "\n";
}

function assistantEntry(id: string, parentId: string): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp: new Date(1700000001000).toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      model: "m",
      provider: "p",
      timestamp: 1700000001000,
    },
  }) + "\n";
}

function originEntry(id: string, parentId: string, data: unknown): string {
  return JSON.stringify({
    type: "custom",
    id,
    parentId,
    timestamp: new Date(1700000000100).toISOString(),
    customType: MESSAGE_ORIGIN_ENTRY_TYPE,
    data,
  }) + "\n";
}

function entry(userId: string, parentId: string, origin: unknown): unknown {
  return {
    origin,
    timestamp: 1700000000100,
    messagePrefix: userId,
  };
}

function load(lines: string[]) {
  const root = sandbox();
  const dir = path.join(root, "sessions", "--tmp-project--");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "s.jsonl");
  writeFileSync(filePath, lines.join(""), "utf8");
  const sm = SessionManager.open(filePath);
  const entries = sm.getEntries() as never;
  return () => buildSessionContext(entries, sm.getLeafId());
}

const CHANNEL_ORIGIN = { kind: "channel", channelId: "wx-1", provider: "wechat", name: "互助群" };

describe("消息来源读取回环", () => {
  it("user message 身后的 origin entry 归属到该消息", () => {
    const ctx = load([
      headerLine("s-1"),
      userEntry("u1", null, "第一句"),
      originEntry("e1", "u1", entry("u1", "u1", CHANNEL_ORIGIN)),
      assistantEntry("a1", "e1"),
    ])();

    expect(ctx.messages).toHaveLength(2);
    const user = ctx.messages[0] as { origin?: unknown };
    expect(normalizeMessageOrigin(user.origin)).toEqual(CHANNEL_ORIGIN);
    // 后续消息不带 origin。
    expect((ctx.messages[1] as { origin?: unknown }).origin).toBeUndefined();
  });

  it("无标记消息不带 origin（历史兼容 ≡ 网页端）", () => {
    const ctx = load([
      headerLine("s-1"),
      userEntry("u1", null, "第一句"),
      assistantEntry("a1", "u1"),
      userEntry("u2", "a1", "第二句"),
    ])();

    for (const m of ctx.messages) {
      expect((m as { origin?: unknown }).origin).toBeUndefined();
    }
  });

  it("分支路径上没有 origin entry 时，entry 随消息树脱落", () => {
    // e1 挂在 u1 之后的 a1 分支；u2→a2 是 u1 直系的另一条分支，路径不含 e1。
    const ctx = load([
      headerLine("s-1"),
      userEntry("u1", null, "第一句"),
      originEntry("e1", "u1", entry("u1", "u1", CHANNEL_ORIGIN)),
      assistantEntry("a1", "e1"),
      userEntry("u2", "u1", "分支一句"),
      assistantEntry("a2", "u2"),
    ])();

    for (const m of ctx.messages) {
      expect((m as { origin?: unknown }).origin).toBeUndefined();
    }
  });

  it("非法 entry 数据不抛错、按缺省处理（不带 origin）", () => {
    const ctx = load([
      headerLine("s-1"),
      userEntry("u1", null, "第一句"),
      originEntry("e1", "u1", { broken: true }),
      assistantEntry("a1", "e1"),
    ])();

    expect((ctx.messages[0] as { origin?: unknown }).origin).toBeUndefined();
  });

  it("别的 customType 不参与归属", () => {
    const root = sandbox();
    const dir = path.join(root, "sessions", "--tmp-project--");
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "s.jsonl");
    const other = JSON.stringify({
      type: "custom",
      id: "e0",
      parentId: null,
      timestamp: new Date(1700000000050).toISOString(),
      customType: "some_other_type",
      data: entry("u1", "u1", CHANNEL_ORIGIN),
    }) + "\n";
    writeFileSync(filePath, [
      headerLine("s-1"),
      userEntry("u1", null, "第一句"),
      originEntry("e1", "u1", entry("u1", "u1", CHANNEL_ORIGIN)),
      assistantEntry("a1", "e1"),
    ].join(""), "utf8");
    void other;
    const sm = SessionManager.open(filePath);
    const ctx = buildSessionContext(sm.getEntries() as never, sm.getLeafId());
    const user = ctx.messages[0] as { origin?: unknown };
    expect(normalizeMessageOrigin(user.origin)).toEqual(CHANNEL_ORIGIN);
  });
});
