import { isSubagentTerminalStatus, type SubagentTaskStatus } from "./types";

const RUNNING_SUBAGENT_STATUSES: readonly SubagentTaskStatus[] = ["creating", "running", "stopping"];

export interface SubagentTaskTiming {
  status: SubagentTaskStatus;
  startedAt: number | null;
  finishedAt: number | null;
}

export type SubagentTaskDuration =
  | { kind: "queued" }
  | { kind: "none" }
  | { kind: "elapsed"; ms: number };

export function resolveSubagentTaskDuration(
  task: SubagentTaskTiming,
  now: number,
): SubagentTaskDuration {
  if (task.finishedAt !== null) {
    if (task.startedAt === null) return { kind: "none" };
    return { kind: "elapsed", ms: task.finishedAt - task.startedAt };
  }
  if (task.startedAt === null) return { kind: "queued" };
  return { kind: "elapsed", ms: Math.max(0, now - task.startedAt) };
}

export function hasRunningSubagentTask(
  tasks: readonly { status: SubagentTaskStatus }[],
): boolean {
  return tasks.some((task) => RUNNING_SUBAGENT_STATUSES.includes(task.status));
}

export function hasUnfinishedSubagentTask(
  tasks: readonly { status: SubagentTaskStatus }[],
): boolean {
  return tasks.some((task) => !isSubagentTerminalStatus(task.status));
}
