import { describe, expect, it } from "vitest";
import { ZH_TRANSLATIONS } from "@/lib/shared/i18n-dict";
import {
  SCHEDULER_DETAIL_SECTION_DEFAULT_OPEN,
  buildSchedulerConfigRows,
  formatSchedulerLifetime,
} from "@/lib/shared/scheduler-detail";
import type { ScheduledTask } from "@/lib/shared/scheduler";

function buildTask(patch: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-1",
    name: "Daily report",
    cron: "0 9 * * *",
    cwd: "/repo",
    prompt: "Summarize yesterday",
    enabled: true,
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    thinkingLevel: "medium",
    toolNames: ["Read", "Bash"],
    permissionMode: "auto_deny",
    maxLifetimeMs: 30 * 60_000,
    timezone: "Asia/Shanghai",
    notification: {
      onSuccess: false,
      onError: true,
      onTimeout: true,
      channels: [{ type: "wechat", channelId: "chan-1", recipientId: "user-1" }],
    },
    createdAt: 0,
    updatedAt: 0,
    lastRunAt: null,
    nextRunAt: null,
    lastRunStatus: null,
    ...patch,
  };
}

describe("formatSchedulerLifetime", () => {
  it("labels an unset lifetime as the runner default", () => {
    expect(formatSchedulerLifetime(null)).toEqual({ text: "2h", isDefault: true });
  });

  it("keeps hours and minutes when both are non-zero", () => {
    expect(formatSchedulerLifetime(90 * 60_000)).toEqual({ text: "1h 30m", isDefault: false });
  });

  it("drops the minute part on a whole hour", () => {
    expect(formatSchedulerLifetime(2 * 60 * 60_000)).toEqual({ text: "2h", isDefault: false });
  });

  it("drops the hour part under an hour", () => {
    expect(formatSchedulerLifetime(45 * 60_000)).toEqual({ text: "45m", isDefault: false });
  });
});

describe("buildSchedulerConfigRows", () => {
  it("lists every execution field exactly once, in a stable order", () => {
    const rows = buildSchedulerConfigRows(buildTask());
    expect(rows.map((row) => row.id)).toEqual([
      "provider",
      "model",
      "thinkingLevel",
      "tools",
      "cwd",
      "maxLifetime",
      "timezone",
      "notifications",
    ]);
  });

  it("gives every row a label with Chinese copy", () => {
    const dict = ZH_TRANSLATIONS as Record<string, string>;
    for (const row of buildSchedulerConfigRows(buildTask())) {
      expect(dict[row.labelKey]).toBeTruthy();
    }
  });

  it("marks unset values as missing", () => {
    const rows = buildSchedulerConfigRows(
      buildTask({ provider: null, modelId: null, thinkingLevel: "auto", notification: null }),
    );
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.value]));
    expect(byId.provider).toEqual({ kind: "missing" });
    expect(byId.model).toEqual({ kind: "missing" });
    expect(byId.thinkingLevel).toEqual({ kind: "missing" });
    expect(byId.notifications).toEqual({ kind: "notifications", outcomes: [], channels: [] });
  });

  it("keeps an empty tool list distinct from unset tools", () => {
    const byId = Object.fromEntries(
      buildSchedulerConfigRows(buildTask({ toolNames: [] })).map((row) => [row.id, row.value]),
    );
    expect(byId.tools).toEqual({ kind: "tools", names: [] });
    const unset = Object.fromEntries(
      buildSchedulerConfigRows(buildTask({ toolNames: null })).map((row) => [row.id, row.value]),
    );
    expect(unset.tools).toEqual({ kind: "tools", names: null });
  });

  it("resolves notification outcomes and channel names", () => {
    const byId = Object.fromEntries(
      buildSchedulerConfigRows(buildTask(), { "chan-1": { name: "On-call", status: "connected" } }).map(
        (row) => [row.id, row.value],
      ),
    );
    expect(byId.notifications).toEqual({
      kind: "notifications",
      outcomes: ["error", "timeout"],
      channels: [
        { type: "wechat", name: "On-call", recipientId: "user-1", unavailable: false },
      ],
    });
  });

  it("flags a channel that cannot be resolved", () => {
    const byId = Object.fromEntries(
      buildSchedulerConfigRows(buildTask()).map((row) => [row.id, row.value]),
    );
    expect(byId.notifications).toEqual({
      kind: "notifications",
      outcomes: ["error", "timeout"],
      channels: [
        { type: "wechat", name: null, recipientId: "user-1", unavailable: true },
      ],
    });
  });
});

describe("SCHEDULER_DETAIL_SECTION_DEFAULT_OPEN", () => {
  it("starts both prompt and execution config collapsed", () => {
    expect(SCHEDULER_DETAIL_SECTION_DEFAULT_OPEN).toEqual({ prompt: false, config: false });
  });
});
