import { describe, expect, it } from "vitest";
import {
  countSchedulerTasks,
  filterSchedulerTasks,
  isSchedulerErrorStatus,
  stepSchedulerSelection,
} from "@/lib/shared/scheduler-filter";
import type { ScheduledTask, TaskRunStatus } from "@/lib/shared/scheduler";

function makeTask(overrides: Partial<ScheduledTask> & { id: string }): ScheduledTask {
  return {
    name: overrides.id,
    cron: "0 8 * * *",
    cwd: "/repo",
    prompt: "",
    enabled: true,
    provider: null,
    modelId: null,
    thinkingLevel: null,
    toolNames: null,
    permissionMode: "full_access",
    maxLifetimeMs: null,
    timezone: "UTC",
    notification: null,
    createdAt: 0,
    updatedAt: 0,
    lastRunAt: null,
    nextRunAt: null,
    lastRunStatus: null,
    ...overrides,
  };
}

const tasks: ScheduledTask[] = [
  makeTask({ id: "daily-report", name: "Daily report", prompt: "summarize the day", cron: "0 8 * * *" }),
  makeTask({ id: "nightly-backup", name: "Nightly backup", cron: "0 2 * * *", enabled: false }),
  makeTask({ id: "flaky-check", name: "Flaky check", cron: "*/5 * * * *", lastRunStatus: "error" }),
  makeTask({ id: "slow-check", name: "Slow check", cron: "0 * * * *", lastRunStatus: "timeout" }),
  makeTask({ id: "nightly-checks", name: "Nightly checks", cron: "0 3 * * *" }),
];

const ids = (list: ScheduledTask[]) => list.map((task) => task.id);

describe("isSchedulerErrorStatus", () => {
  it("counts failures, timeouts and interruptions as errors", () => {
    const errorish: TaskRunStatus[] = ["error", "timeout", "interrupted"];
    for (const status of errorish) expect(isSchedulerErrorStatus(status)).toBe(true);
  });

  it("does not flag success, running or a task that never ran", () => {
    expect(isSchedulerErrorStatus("success")).toBe(false);
    expect(isSchedulerErrorStatus("running")).toBe(false);
    expect(isSchedulerErrorStatus(null)).toBe(false);
  });
});

describe("filterSchedulerTasks", () => {
  it("keeps every task under the all filter", () => {
    expect(ids(filterSchedulerTasks(tasks, "all", ""))).toEqual(ids(tasks));
  });

  it("splits enabled from paused", () => {
    expect(ids(filterSchedulerTasks(tasks, "enabled", ""))).toEqual([
      "daily-report",
      "flaky-check",
      "slow-check",
      "nightly-checks",
    ]);
    expect(ids(filterSchedulerTasks(tasks, "disabled", ""))).toEqual(["nightly-backup"]);
  });

  it("keeps only tasks whose last run failed under the error filter", () => {
    expect(ids(filterSchedulerTasks(tasks, "error", ""))).toEqual(["flaky-check", "slow-check"]);
  });

  it("searches name, cron and prompt case-insensitively", () => {
    expect(ids(filterSchedulerTasks(tasks, "all", "NIGHTLY"))).toEqual([
      "nightly-backup",
      "nightly-checks",
    ]);
    expect(ids(filterSchedulerTasks(tasks, "all", "summarize"))).toEqual(["daily-report"]);
    expect(ids(filterSchedulerTasks(tasks, "all", "*/5"))).toEqual(["flaky-check"]);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(ids(filterSchedulerTasks(tasks, "all", "   "))).toEqual(ids(tasks));
  });

  it("combines the filter and the query", () => {
    expect(ids(filterSchedulerTasks(tasks, "enabled", "nightly"))).toEqual(["nightly-checks"]);
  });

  it("returns nothing when the query matches nothing", () => {
    expect(filterSchedulerTasks(tasks, "all", "no-such-task")).toEqual([]);
  });
});

describe("countSchedulerTasks", () => {
  it("counts the tasks each filter pill would show", () => {
    expect(countSchedulerTasks(tasks, "all")).toBe(5);
    expect(countSchedulerTasks(tasks, "enabled")).toBe(4);
    expect(countSchedulerTasks(tasks, "disabled")).toBe(1);
    expect(countSchedulerTasks(tasks, "error")).toBe(2);
  });

  it("counts an empty list as zero", () => {
    expect(countSchedulerTasks([], "all")).toBe(0);
  });
});

describe("stepSchedulerSelection", () => {
  const order = ["a", "b", "c"];

  it("enters the list from either end when nothing is selected", () => {
    expect(stepSchedulerSelection(order, null, "next")).toBe("a");
    expect(stepSchedulerSelection(order, null, "previous")).toBe("c");
  });

  it("moves one row in the requested direction", () => {
    expect(stepSchedulerSelection(order, "a", "next")).toBe("b");
    expect(stepSchedulerSelection(order, "c", "previous")).toBe("b");
  });

  it("stops at the ends instead of wrapping around", () => {
    expect(stepSchedulerSelection(order, "c", "next")).toBe("c");
    expect(stepSchedulerSelection(order, "a", "previous")).toBe("a");
  });

  it("re-enters from an end when the selection fell out of the filtered list", () => {
    expect(stepSchedulerSelection(order, "gone", "next")).toBe("a");
    expect(stepSchedulerSelection(order, "gone", "previous")).toBe("c");
  });

  it("has nothing to move to in an empty list", () => {
    expect(stepSchedulerSelection([], null, "next")).toBeNull();
    expect(stepSchedulerSelection([], "a", "previous")).toBeNull();
  });
});
