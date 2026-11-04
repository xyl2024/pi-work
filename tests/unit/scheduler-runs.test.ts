import { describe, expect, it } from "vitest";
import {
  SCHEDULER_LONG_RUNNING_MS,
  computeSchedulerRunStats,
  countSchedulerRuns,
  filterSchedulerRuns,
  isSchedulerLongRunning,
  resolveSchedulerRunSelection,
  schedulerRunDurationMs,
  selectMostRecentRunId,
} from "@/lib/shared/scheduler-runs";
import type { TaskRun } from "@/lib/shared/scheduler";

function makeRun(patch: Partial<TaskRun> & { id: string }): TaskRun {
  return {
    taskId: "task-1",
    startedAt: 0,
    endedAt: null,
    status: "success",
    replyText: null,
    error: null,
    sessionId: null,
    durationMs: null,
    ...patch,
  };
}

const runs: TaskRun[] = [
  makeRun({ id: "success-run", startedAt: 1_000, endedAt: 3_000, status: "success", durationMs: 2_000 }),
  makeRun({ id: "timeout-run", startedAt: 2_000, endedAt: 62_000, status: "timeout", durationMs: 60_000 }),
  makeRun({ id: "error-run", startedAt: 3_000, endedAt: 7_000, status: "error", durationMs: 4_000 }),
  makeRun({ id: "running-run", startedAt: 5_000, status: "running" }),
];

const ids = (list: TaskRun[]) => list.map((run) => run.id);

describe("filterSchedulerRuns", () => {
  it("keeps every run under the all filter", () => {
    expect(ids(filterSchedulerRuns(runs, "all"))).toEqual(ids(runs));
  });

  it("keeps only the runs matching the chosen status", () => {
    expect(ids(filterSchedulerRuns(runs, "success"))).toEqual(["success-run"]);
    expect(ids(filterSchedulerRuns(runs, "error"))).toEqual(["error-run"]);
    expect(ids(filterSchedulerRuns(runs, "timeout"))).toEqual(["timeout-run"]);
    expect(ids(filterSchedulerRuns(runs, "interrupted"))).toEqual([]);
    expect(ids(filterSchedulerRuns(runs, "running"))).toEqual(["running-run"]);
  });

  it("does not reorder the runs", () => {
    expect(ids(filterSchedulerRuns(runs, "all"))).toEqual(ids(runs));
  });
});

describe("countSchedulerRuns", () => {
  it("counts the runs each filter pill would show", () => {
    expect(countSchedulerRuns(runs, "all")).toBe(4);
    expect(countSchedulerRuns(runs, "success")).toBe(1);
    expect(countSchedulerRuns(runs, "error")).toBe(1);
    expect(countSchedulerRuns(runs, "timeout")).toBe(1);
    expect(countSchedulerRuns(runs, "interrupted")).toBe(0);
    expect(countSchedulerRuns(runs, "running")).toBe(1);
  });

  it("counts an empty list as zero", () => {
    expect(countSchedulerRuns([], "all")).toBe(0);
  });
});

describe("computeSchedulerRunStats", () => {
  it("counts every run but rates only the finished ones", () => {
    expect(computeSchedulerRunStats(runs)).toEqual({
      total: 4,
      completed: 3,
      successRate: 1 / 3,
      avgDurationMs: 22_000,
    });
  });

  it("reports no average duration before any run has finished", () => {
    expect(computeSchedulerRunStats([makeRun({ id: "waiting", status: "running" })])).toEqual({
      total: 1,
      completed: 0,
      successRate: 0,
      avgDurationMs: null,
    });
  });

  it("reports zeroes for an empty history", () => {
    expect(computeSchedulerRunStats([])).toEqual({
      total: 0,
      completed: 0,
      successRate: 0,
      avgDurationMs: null,
    });
  });

  it("counts errors, timeouts and interruptions as failures", () => {
    const stats = computeSchedulerRunStats([
      makeRun({ id: "ok", status: "success", durationMs: 1_000 }),
      makeRun({ id: "err", status: "error", durationMs: 1_000 }),
      makeRun({ id: "late", status: "timeout", durationMs: 1_000 }),
      makeRun({ id: "cut", status: "interrupted", durationMs: 1_000 }),
    ]);
    expect(stats.completed).toBe(4);
    expect(stats.successRate).toBe(0.25);
  });
});

describe("selectMostRecentRunId", () => {
  it("picks the run that started last, not the first in the list", () => {
    expect(selectMostRecentRunId(runs)).toBe("running-run");
  });

  it("returns null when there is nothing to select", () => {
    expect(selectMostRecentRunId([])).toBeNull();
  });
});

describe("resolveSchedulerRunSelection", () => {
  it("keeps an explicitly selected run that still exists", () => {
    expect(resolveSchedulerRunSelection(runs, "success-run")).toBe("success-run");
  });

  it("falls back to the most recent run when nothing is selected", () => {
    expect(resolveSchedulerRunSelection(runs, null)).toBe("running-run");
  });

  it("falls back when the selected run is gone", () => {
    expect(resolveSchedulerRunSelection(runs, "run-from-another-task")).toBe("running-run");
  });

  it("selects nothing when the task has no runs", () => {
    expect(resolveSchedulerRunSelection([], "run-from-another-task")).toBeNull();
  });
});

describe("schedulerRunDurationMs", () => {
  it("uses the recorded duration of a finished run", () => {
    expect(schedulerRunDurationMs(runs[0], 99_999)).toBe(2_000);
  });

  it("measures a running run against the clock", () => {
    expect(schedulerRunDurationMs(runs[3], 15_000)).toBe(10_000);
  });

  it("never reports negative elapsed time", () => {
    expect(schedulerRunDurationMs(runs[3], 1_000)).toBe(0);
  });

  it("returns null when a finished run has no duration", () => {
    expect(schedulerRunDurationMs(makeRun({ id: "finished", status: "error" }), 9_999)).toBeNull();
  });
});

describe("isSchedulerLongRunning", () => {
  it("marks a running run once it crosses the ten minute threshold", () => {
    const running = makeRun({ id: "slow", startedAt: 0, status: "running" });
    expect(SCHEDULER_LONG_RUNNING_MS).toBe(10 * 60 * 1000);
    expect(isSchedulerLongRunning(running, SCHEDULER_LONG_RUNNING_MS - 1)).toBe(false);
    expect(isSchedulerLongRunning(running, SCHEDULER_LONG_RUNNING_MS)).toBe(true);
  });

  it("never marks a finished run, however long it took", () => {
    const finished = makeRun({ id: "slow", startedAt: 0, status: "success", durationMs: 60 * 60_000 });
    expect(isSchedulerLongRunning(finished, 24 * 60 * 60_000)).toBe(false);
  });
});
