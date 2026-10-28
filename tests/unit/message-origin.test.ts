// Seam A：消息来源的共享纯函数（spec：.scratch/message-origin/spec.md）。
// 缺省回退（无标记 ≡ 网页端）、origin → 图标/名称/悬停文案映射（文案是 i18n
// 词典键）、prompt + origin → 待写 entry 数据（毫秒时间戳 + 文本前 80 字符）、
// customType `pi_work_message_origin` 的类型守卫。非法数据不抛错、按缺省处理。
import { describe, expect, it } from "vitest";

import {
  MESSAGE_ORIGIN_ENTRY_TYPE,
  buildMessageOriginEntryData,
  isMessageOrigin,
  isMessageOriginEntryData,
  messageOriginDisplay,
  normalizeMessageOrigin,
} from "@/lib/shared/message-origin";

describe("normalizeMessageOrigin (缺省回退)", () => {
  it("无标记回落到网页端", () => {
    expect(normalizeMessageOrigin(undefined)).toEqual({ kind: "web" });
    expect(normalizeMessageOrigin(null)).toEqual({ kind: "web" });
  });

  it("非法数据按缺省处理，不抛错", () => {
    expect(normalizeMessageOrigin("channel")).toEqual({ kind: "web" });
    expect(normalizeMessageOrigin({ kind: "channel" })).toEqual({ kind: "web" });
    expect(normalizeMessageOrigin({ kind: "scheduled-task", taskId: 1 })).toEqual({ kind: "web" });
    expect(normalizeMessageOrigin({ kind: "unknown-kind" })).toEqual({ kind: "web" });
    expect(normalizeMessageOrigin(42)).toEqual({ kind: "web" });
  });

  it("合法来源原样保留 id 与名称快照", () => {
    const channel = { kind: "channel", channelId: "wx-1", provider: "wechat", name: "互助群" };
    expect(normalizeMessageOrigin(channel)).toEqual(channel);
    const task = { kind: "scheduled-task", taskId: "t-1", name: "日报" };
    expect(normalizeMessageOrigin(task)).toEqual(task);
    const sub = {
      kind: "subagent-session",
      parentSessionId: "p-1",
      parentSessionTitle: "重构 auth",
      childSessionId: "c-1",
    };
    expect(normalizeMessageOrigin(sub)).toEqual(sub);
    expect(normalizeMessageOrigin({ kind: "web" })).toEqual({ kind: "web" });
  });
});

describe("isMessageOrigin (类型守卫)", () => {
  it("接受四种合法形状", () => {
    expect(isMessageOrigin({ kind: "web" })).toBe(true);
    expect(
      isMessageOrigin({ kind: "channel", channelId: "c", provider: "wechat", name: "n" }),
    ).toBe(true);
    expect(isMessageOrigin({ kind: "scheduled-task", taskId: "t", name: "n" })).toBe(true);
    expect(
      isMessageOrigin({
        kind: "subagent-session",
        parentSessionId: "p",
        parentSessionTitle: "t",
        childSessionId: "c",
      }),
    ).toBe(true);
  });

  it("拒绝非法形状（含字段缺失、类型不对）", () => {
    expect(isMessageOrigin(undefined)).toBe(false);
    expect(isMessageOrigin("web")).toBe(false);
    expect(isMessageOrigin({ kind: "channel", provider: "wechat", name: "n" })).toBe(false);
    expect(isMessageOrigin({ kind: "subagent-session", parentSessionId: "p" })).toBe(false);
  });
});

describe("buildMessageOriginEntryData", () => {
  it("记录毫秒时间戳与文本前 80 字符", () => {
    const data = buildMessageOriginEntryData(
      "你好",
      { kind: "scheduled-task", taskId: "t-1", name: "日报" },
      1700000000000,
    );
    expect(data).toEqual({
      origin: { kind: "scheduled-task", taskId: "t-1", name: "日报" },
      timestamp: 1700000000000,
      messagePrefix: "你好",
    });
    expect(isMessageOriginEntryData(data)).toBe(true);
  });

  it("文本前缀截断到 80 字符（仅诊断用）", () => {
    const data = buildMessageOriginEntryData(
      "x".repeat(120),
      { kind: "channel", channelId: "c", provider: "wechat", name: "n" },
      1700000000000,
    );
    expect(data.messagePrefix.length).toBe(80);
  });

  it("多字文本按码点截断，不产生半个代理对", () => {
    const text = "😀".repeat(60); // 60 个码点、120 个 code unit
    const data = buildMessageOriginEntryData(text, { kind: "web" }, 1700000000000);
    expect(data.messagePrefix).toBe("😀".repeat(60));
  });

  it("守卫拒绝非法 entry 数据", () => {
    expect(isMessageOriginEntryData(undefined)).toBe(false);
    expect(isMessageOriginEntryData({ origin: { kind: "web" }, timestamp: "x", messagePrefix: "" }))
      .toBe(false);
    expect(isMessageOriginEntryData({ origin: { kind: "bogus" }, timestamp: 1, messagePrefix: "" }))
      .toBe(false);
    expect(isMessageOriginEntryData({ origin: { kind: "web" }, timestamp: 1 })).toBe(false);
  });
});

describe("messageOriginDisplay (origin → 图标/名称/悬停文案)", () => {
  it("频道：频道图标 + 频道名 + 来自频道的悬停键", () => {
    const d = messageOriginDisplay({
      kind: "channel",
      channelId: "c",
      provider: "wechat",
      name: "互助群",
    });
    expect(d.icon).toBe("MessageCircle");
    expect(d.label).toBe("互助群");
    expect(d.hover).toEqual({ key: "Message from channel {channel}", params: { channel: "互助群" } });
  });

  it("定时任务：任务图标 + 任务名", () => {
    const d = messageOriginDisplay({ kind: "scheduled-task", taskId: "t", name: "日报" });
    expect(d.icon).toBe("CalendarClock");
    expect(d.label).toBe("日报");
    expect(d.hover).toEqual({ key: "Message from scheduled task {task}", params: { task: "日报" } });
  });

  it("子代理会话：机器人图标 + 父会话标题", () => {
    const d = messageOriginDisplay({
      kind: "subagent-session",
      parentSessionId: "p",
      parentSessionTitle: "重构 auth",
      childSessionId: "c",
    });
    expect(d.icon).toBe("Bot");
    expect(d.label).toBe("重构 auth");
    expect(d.hover).toEqual({
      key: "Message from session {session}",
      params: { session: "重构 auth" },
    });
  });

  it("网页端（含缺省）：无替换图标/名称/悬停，渲染走现有头像", () => {
    expect(messageOriginDisplay({ kind: "web" })).toEqual({ icon: undefined, label: undefined, hover: undefined });
    expect(messageOriginDisplay(undefined)).toEqual({ icon: undefined, label: undefined, hover: undefined });
  });
});

describe("原始 customType 常量", () => {
  it("钉住 wire 值", () => {
    expect(MESSAGE_ORIGIN_ENTRY_TYPE).toBe("pi_work_message_origin");
  });
});
