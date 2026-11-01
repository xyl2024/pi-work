import type {
  SubagentSessionStatsView,
  SubagentTaskSummary,
} from "./types";

export interface SubagentSessionGroup {
  sessionId: string | null;
  latestTask: SubagentTaskSummary;
  historyTasks: SubagentTaskSummary[];
  stats: SubagentSessionStatsView | null;
}

export interface SubagentSessionsProjection {
  groups: SubagentSessionGroup[];
  taskCount: number;
}

function numericTaskId(taskId: string): number | null {
  const trimmed = taskId.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function compareSubagentTaskIdDesc(a: string, b: string): number {
  const left = numericTaskId(a);
  const right = numericTaskId(b);
  if (left !== null && right !== null) return right - left;
  if (left !== null) return -1;
  if (right !== null) return 1;
  return 0;
}

function groupKey(task: SubagentTaskSummary): string {
  return task.childSessionId ?? `task:${task.taskId}`;
}

export function projectSubagentSessionGroups(
  tasks: readonly SubagentTaskSummary[],
  sessions: readonly SubagentSessionStatsView[] | null | undefined,
): SubagentSessionsProjection {
  const statsBySession = new Map<string, SubagentSessionStatsView>();
  for (const session of sessions ?? []) {
    if (!statsBySession.has(session.sessionId)) statsBySession.set(session.sessionId, session);
  }

  const grouped = new Map<string, SubagentTaskSummary[]>();
  for (const task of tasks) {
    const key = groupKey(task);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(task);
    else grouped.set(key, [task]);
  }

  const groups: SubagentSessionGroup[] = [];
  for (const [, bucket] of grouped) {
    const ordered = [...bucket].sort((a, b) => compareSubagentTaskIdDesc(a.taskId, b.taskId));
    const childSessionId = ordered[0].childSessionId ?? null;
    groups.push({
      sessionId: childSessionId,
      latestTask: ordered[0],
      historyTasks: ordered.slice(1),
      stats: childSessionId ? statsBySession.get(childSessionId) ?? null : null,
    });
  }

  groups.sort((a, b) => compareSubagentTaskIdDesc(a.latestTask.taskId, b.latestTask.taskId));

  return { groups, taskCount: tasks.length };
}
