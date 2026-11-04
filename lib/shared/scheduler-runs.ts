import type { TaskRun, TaskRunStatus } from "./scheduler";

export type SchedulerRunFilter = "all" | TaskRunStatus;

export const SCHEDULER_RUN_FILTERS: readonly SchedulerRunFilter[] = [
  "all",
  "success",
  "error",
  "timeout",
  "interrupted",
  "running",
];

export const SCHEDULER_LONG_RUNNING_MS = 10 * 60 * 1000;

export interface SchedulerRunStats {
  total: number;
  completed: number;
  successRate: number;
  avgDurationMs: number | null;
}

export function filterSchedulerRuns(runs: TaskRun[], filter: SchedulerRunFilter): TaskRun[] {
  if (filter === "all") return runs;
  return runs.filter((run) => run.status === filter);
}

export function countSchedulerRuns(runs: TaskRun[], filter: SchedulerRunFilter): number {
  if (filter === "all") return runs.length;
  return runs.filter((run) => run.status === filter).length;
}

export function computeSchedulerRunStats(runs: TaskRun[]): SchedulerRunStats {
  let completed = 0;
  let success = 0;
  let durationSum = 0;
  let durationCount = 0;
  for (const run of runs) {
    if (run.status !== "running") {
      completed += 1;
      if (run.status === "success") success += 1;
    }
    if (run.durationMs !== null) {
      durationSum += run.durationMs;
      durationCount += 1;
    }
  }
  return {
    total: runs.length,
    completed,
    successRate: completed === 0 ? 0 : success / completed,
    avgDurationMs: durationCount === 0 ? null : Math.round(durationSum / durationCount),
  };
}

export function selectMostRecentRunId(runs: TaskRun[]): string | null {
  let latest: TaskRun | null = null;
  for (const run of runs) {
    if (latest === null || run.startedAt > latest.startedAt) latest = run;
  }
  return latest?.id ?? null;
}

export function resolveSchedulerRunSelection(runs: TaskRun[], selectedRunId: string | null): string | null {
  if (selectedRunId !== null && runs.some((run) => run.id === selectedRunId)) return selectedRunId;
  return selectMostRecentRunId(runs);
}

export function schedulerRunDurationMs(run: TaskRun, now: number): number | null {
  if (run.durationMs !== null) return run.durationMs;
  if (run.status !== "running") return null;
  return Math.max(0, now - run.startedAt);
}

export function isSchedulerLongRunning(run: TaskRun, now: number): boolean {
  if (run.status !== "running") return false;
  return now - run.startedAt >= SCHEDULER_LONG_RUNNING_MS;
}
