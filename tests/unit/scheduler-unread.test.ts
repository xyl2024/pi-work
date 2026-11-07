import { describe, expect, it } from "vitest";

import {
  NO_SCHEDULER_UNREAD,
  formatUnreadSegment,
  hasSchedulerUnread,
  isSchedulerRunFailure,
  tallySchedulerUnread,
} from "@/lib/shared/scheduler-unread";

describe("isSchedulerRunFailure", () => {
  it("成功与运行中不算失败", () => {
    expect(isSchedulerRunFailure("success")).toBe(false);
    expect(isSchedulerRunFailure("running")).toBe(false);
  });

  it("错误、超时、中断都算失败", () => {
    expect(isSchedulerRunFailure("error")).toBe(true);
    expect(isSchedulerRunFailure("timeout")).toBe(true);
    expect(isSchedulerRunFailure("interrupted")).toBe(true);
  });
});

describe("tallySchedulerUnread", () => {
  it("按状态分组累计成成功 / 失败两段", () => {
    expect(tallySchedulerUnread({ success: 4, error: 2, timeout: 1 })).toEqual({ success: 4, failed: 3 });
  });

  it("缺省与零值不产生未读", () => {
    expect(tallySchedulerUnread({})).toEqual(NO_SCHEDULER_UNREAD);
    expect(tallySchedulerUnread({ success: 0, error: 0 })).toEqual(NO_SCHEDULER_UNREAD);
  });
});

describe("hasSchedulerUnread", () => {
  it("任意一段大于零即为有未读", () => {
    expect(hasSchedulerUnread({ success: 1, failed: 0 })).toBe(true);
    expect(hasSchedulerUnread({ success: 0, failed: 2 })).toBe(true);
    expect(hasSchedulerUnread({ success: 0, failed: 0 })).toBe(false);
  });
});

describe("formatUnreadSegment", () => {
  it("超过两位数的计数收敛成 99+，避免撑破侧栏", () => {
    expect(formatUnreadSegment(7)).toBe("7");
    expect(formatUnreadSegment(99)).toBe("99");
    expect(formatUnreadSegment(100)).toBe("99+");
  });
});
