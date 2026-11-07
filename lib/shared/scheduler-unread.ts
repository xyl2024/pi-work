import type { TaskRunStatus } from "./scheduler";

export interface SchedulerUnreadCounts {
  success: number;
  failed: number;
}

export const NO_SCHEDULER_UNREAD: SchedulerUnreadCounts = { success: 0, failed: 0 };

export function isSchedulerRunFailure(status: TaskRunStatus): boolean {
  return status !== "success" && status !== "running";
}

export function tallySchedulerUnread(countByStatus: Partial<Record<TaskRunStatus, number>>): SchedulerUnreadCounts {
  let success = 0;
  let failed = 0;
  for (const [status, count] of Object.entries(countByStatus)) {
    if (!count) continue;
    if (isSchedulerRunFailure(status as TaskRunStatus)) failed += count;
    else success += count;
  }
  return { success, failed };
}

export function hasSchedulerUnread(counts: SchedulerUnreadCounts): boolean {
  return counts.success + counts.failed > 0;
}

export function formatUnreadSegment(count: number): string {
  return count > 99 ? "99+" : String(count);
}
