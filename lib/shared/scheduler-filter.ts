import type { ScheduledTask, TaskRunStatus } from "./scheduler";

export type SchedulerFilter = "all" | "enabled" | "disabled" | "error";

export function isSchedulerErrorStatus(status: TaskRunStatus | null): boolean {
  return status === "error" || status === "timeout" || status === "interrupted";
}

export function filterSchedulerTasks(
  tasks: ScheduledTask[],
  filter: SchedulerFilter,
  query: string,
): ScheduledTask[] {
  const q = query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (filter === "enabled" && !task.enabled) return false;
    if (filter === "disabled" && task.enabled) return false;
    if (filter === "error" && !isSchedulerErrorStatus(task.lastRunStatus)) return false;
    if (q.length > 0) {
      const haystack = `${task.name} ${task.cron} ${task.prompt}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function countSchedulerTasks(tasks: ScheduledTask[], filter: SchedulerFilter): number {
  switch (filter) {
    case "all":
      return tasks.length;
    case "enabled":
      return tasks.filter((task) => task.enabled).length;
    case "disabled":
      return tasks.filter((task) => !task.enabled).length;
    case "error":
      return tasks.filter((task) => isSchedulerErrorStatus(task.lastRunStatus)).length;
  }
}

export type SchedulerSelectionStep = "next" | "previous";

export function stepSchedulerSelection(
  ids: readonly string[],
  currentId: string | null,
  step: SchedulerSelectionStep,
): string | null {
  if (ids.length === 0) return null;
  const index = currentId === null ? -1 : ids.indexOf(currentId);
  if (index === -1) return step === "next" ? ids[0] : ids[ids.length - 1];
  const delta = step === "next" ? 1 : -1;
  return ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
}
