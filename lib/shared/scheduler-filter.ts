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
