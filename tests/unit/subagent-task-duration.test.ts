import { describe, expect, it } from "vitest";
import {
  hasUnfinishedSubagentTask,
  resolveSubagentTaskDuration,
} from "@/lib/shared/subagent-task-duration";

describe("resolveSubagentTaskDuration", () => {
  it("reports queued when the task has not started and has not finished", () => {
    expect(
      resolveSubagentTaskDuration(
        { status: "queued", startedAt: null, finishedAt: null },
        1_700_000_000_000,
      ),
    ).toEqual({ kind: "queued" });
  });

  it("reports elapsed execution time while running", () => {
    expect(
      resolveSubagentTaskDuration(
        { status: "running", startedAt: 1_000, finishedAt: null },
        3_500,
      ),
    ).toEqual({ kind: "elapsed", ms: 2_500 });
  });

  it("never reports negative elapsed time when the clock moves backwards", () => {
    expect(
      resolveSubagentTaskDuration(
        { status: "running", startedAt: 5_000, finishedAt: null },
        1_000,
      ),
    ).toEqual({ kind: "elapsed", ms: 0 });
  });

  it("freezes the final execution time after completion", () => {
    expect(
      resolveSubagentTaskDuration(
        { status: "completed", startedAt: 2_000, finishedAt: 9_500 },
        1_000_000,
      ),
    ).toEqual({ kind: "elapsed", ms: 7_500 });
  });

  it("uses the same window after failure", () => {
    expect(
      resolveSubagentTaskDuration(
        { status: "failed", startedAt: 2_000, finishedAt: 4_250 },
        1_000_000,
      ),
    ).toEqual({ kind: "elapsed", ms: 2_250 });
  });

  it("uses the same window when cancelled after starting", () => {
    expect(
      resolveSubagentTaskDuration(
        { status: "cancelled", startedAt: 10_000, finishedAt: 13_000 },
        1_000_000,
      ),
    ).toEqual({ kind: "elapsed", ms: 3_000 });
  });

  it("reports no execution time when cancelled before starting", () => {
    expect(
      resolveSubagentTaskDuration(
        { status: "cancelled", startedAt: null, finishedAt: 13_000 },
        1_000_000,
      ),
    ).toEqual({ kind: "none" });
  });

  it("excludes queue time from the final execution time", () => {
    const createdAt = 1_000;
    const startedAt = 60_000;
    const finishedAt = 64_500;

    expect(createdAt).toBeLessThan(startedAt);
    expect(
      resolveSubagentTaskDuration(
        { status: "completed", startedAt, finishedAt },
        finishedAt,
      ),
    ).toEqual({ kind: "elapsed", ms: 4_500 });
  });
});

describe("hasUnfinishedSubagentTask", () => {
  it("is false for an empty list", () => {
    expect(hasUnfinishedSubagentTask([])).toBe(false);
  });

  it("detects a single running task among finished tasks from another session", () => {
    expect(
      hasUnfinishedSubagentTask([
        { status: "completed" },
        { status: "failed" },
        { status: "running" },
      ]),
    ).toBe(true);
  });

  it("treats queued tasks as unfinished", () => {
    expect(hasUnfinishedSubagentTask([{ status: "queued" }])).toBe(true);
  });

  it("is false once every task has finished", () => {
    expect(
      hasUnfinishedSubagentTask([
        { status: "completed" },
        { status: "failed" },
        { status: "cancelled" },
        { status: "interrupted" },
      ]),
    ).toBe(false);
  });
});
