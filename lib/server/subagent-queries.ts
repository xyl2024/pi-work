import {
  SUBAGENT_ACTIVITY_DEFAULT_LIMIT,
  SUBAGENT_ACTIVITY_MAX_LIMIT,
  SUBAGENT_LIST_DEFAULT_LIMIT,
  SUBAGENT_LIST_MAX_LIMIT,
  SUBAGENT_RESULT_WINDOW_DEFAULT,
  SUBAGENT_RESULT_WINDOW_MAX,
  SUBAGENT_TRANSCRIPT_DEFAULT_LIMIT,
  SUBAGENT_TRANSCRIPT_MAX_LIMIT,
  SUBAGENT_TRANSCRIPT_MESSAGE_MAX,
  sliceSubagentText,
  type SubagentTextWindow,
} from "../shared/subagent";
import {
  isSubagentTerminalStatus,
  type SubagentActivityItem,
  type SubagentTaskOrigin,
  type SubagentTaskStatus,
} from "../shared/types";
import { getSubagentTask, listSubagentTasks, listSubagentTasksForChildSession, type SubagentTask } from "./subagent-store";
import { getSubagentTaskManager } from "./subagent-tasks";
import { readSessionDetails, readSubagentLiveInfo, summarizeToolInput } from "./sessions/reader";

export class SubagentQueryError extends Error {}

export const SUBAGENT_TASK_NOT_FOUND =
  "No subagent task with that task_id in this session. Only direct subagent tasks of the calling session are readable.";

export const SUBAGENT_SESSION_NOT_FOUND =
  "No subagent session with that session_id in this session. Only direct subagents of the calling session are readable.";

export interface SubagentTaskView {
  taskId: string;
  parentSessionId: string;
  childSessionId: string | null;
  subagentName: string;
  description: string;
  origin: SubagentTaskOrigin;
  status: SubagentTaskStatus;
  error: string | null;
  resultLength: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export function resolveSubagentTaskStatus(
  task: Pick<SubagentTask, "parentSessionId" | "taskId" | "status">,
): SubagentTaskStatus {
  if (isSubagentTerminalStatus(task.status)) return task.status;
  const live = getSubagentTaskManager().liveStatus(task.parentSessionId, task.taskId);
  return live ?? "interrupted";
}

export function toSubagentTaskView(task: SubagentTask): SubagentTaskView {
  return {
    taskId: task.taskId,
    parentSessionId: task.parentSessionId,
    childSessionId: task.childSessionId,
    subagentName: task.subagentName,
    description: task.description,
    origin: task.origin,
    status: resolveSubagentTaskStatus(task),
    error: task.error,
    resultLength: task.result?.length ?? 0,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
  };
}

export interface SubagentSessionEntry {
  sessionId: string | null;
  latestTask: SubagentTaskView;
  taskCount: number;
}

export interface SubagentSessionList {
  entries: SubagentSessionEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  status: SubagentTaskStatus | null;
}

export interface ListSubagentSessionsInput {
  parentSessionId: string;
  status?: SubagentTaskStatus;
  limit?: number;
  offset?: number;
}

function clampPageSize(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(value)));
}

function clampCount(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}

function clampOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

export function listSubagentSessions(input: ListSubagentSessionsInput): SubagentSessionList {
  const rows = listSubagentTasks(input.parentSessionId);
  const groups = new Map<string, { sessionId: string | null; tasks: SubagentTask[] }>();
  for (const row of rows) {
    const key = row.childSessionId ?? `task:${row.taskId}`;
    const group = groups.get(key);
    if (group) group.tasks.push(row);
    else groups.set(key, { sessionId: row.childSessionId, tasks: [row] });
  }

  const entries: SubagentSessionEntry[] = [];
  for (const group of groups.values()) {
    const latestTask = toSubagentTaskView(group.tasks[0]);
    if (input.status && latestTask.status !== input.status) continue;
    entries.push({ sessionId: group.sessionId, latestTask, taskCount: group.tasks.length });
  }

  const total = entries.length;
  const limit = clampPageSize(input.limit, SUBAGENT_LIST_DEFAULT_LIMIT, SUBAGENT_LIST_MAX_LIMIT);
  const offset = clampOffset(input.offset);
  const page = entries.slice(offset, offset + limit);
  return {
    entries: page,
    total,
    offset,
    limit,
    hasMore: offset + page.length < total,
    status: input.status ?? null,
  };
}

export interface SubagentTranscriptMessage {
  role: string;
  text: string;
  truncated: boolean;
  totalLength: number;
  skipped: number;
  nextCharOffset: number | null;
  timestamp: number | null;
}

export interface SubagentTranscriptPage {
  messages: SubagentTranscriptMessage[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface SubagentTaskDetail {
  task: SubagentTaskView;
  result: SubagentTextWindow | null;
  activities: SubagentActivityItem[];
  activityCount: number;
  transcript: SubagentTranscriptPage | null;
}

export interface SubagentSessionDetail {
  sessionId: string;
  taskCount: number;
  latest: SubagentTaskDetail;
  tasks: {
    items: SubagentTaskView[];
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
}

export interface ReadSubagentTaskInput {
  parentSessionId: string;
  taskId: string;
  resultOffset?: number;
  resultLimit?: number;
  activityLimit?: number;
  transcriptOffset?: number;
  transcriptLimit?: number;
  transcriptCharOffset?: number;
}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const value = block as { type?: unknown; text?: unknown; toolName?: unknown; input?: unknown };
    if (value.type === "text" && typeof value.text === "string") {
      if (value.text.trim()) parts.push(value.text);
      continue;
    }
    if (value.type === "toolCall" && typeof value.toolName === "string") {
      const summary = summarizeToolInput(value.input);
      parts.push(`[tool ${value.toolName}]${summary ? ` ${summary}` : ""}`);
    }
  }
  return parts.join("\n\n").trim();
}

async function readTranscriptPage(
  childSessionId: string,
  offset: number,
  limit: number,
  charOffset: number,
): Promise<SubagentTranscriptPage | null> {
  let details: Awaited<ReturnType<typeof readSessionDetails>>;
  try {
    details = await readSessionDetails(childSessionId);
  } catch {
    return null;
  }
  if (!details) return null;

  const messages = details.context.messages;
  const start = Math.min(clampOffset(offset), messages.length);
  const end = Math.min(messages.length, start + limit);
  const page: SubagentTranscriptMessage[] = [];
  for (let i = start; i < end; i += 1) {
    const message = messages[i] as { role?: unknown };
    const text = messageText(message);
    const window = sliceSubagentText(text, charOffset, SUBAGENT_TRANSCRIPT_MESSAGE_MAX);
    page.push({
      role: typeof message.role === "string" ? message.role : "unknown",
      text: window.text,
      truncated: window.truncated,
      totalLength: window.total,
      skipped: window.skipped,
      nextCharOffset: window.nextOffset,
      timestamp: details.context.entryTimestamps?.[i] ?? null,
    });
  }
  return {
    messages: page,
    total: messages.length,
    offset: start,
    limit,
    hasMore: end < messages.length,
    nextOffset: end < messages.length ? end : null,
  };
}

async function readTaskDetail(task: SubagentTask, input: Omit<ReadSubagentTaskInput, "parentSessionId" | "taskId">): Promise<SubagentTaskDetail> {
  const result = task.result
    ? sliceSubagentText(
      task.result,
      clampOffset(input.resultOffset),
      clampPageSize(input.resultLimit, SUBAGENT_RESULT_WINDOW_DEFAULT, SUBAGENT_RESULT_WINDOW_MAX),
    )
    : null;

  const activityLimit = clampCount(input.activityLimit, SUBAGENT_ACTIVITY_DEFAULT_LIMIT, SUBAGENT_ACTIVITY_MAX_LIMIT);
  let activities: SubagentActivityItem[] = [];
  let activityCount = 0;
  if (task.childSessionId) {
    try {
      const live = await readSubagentLiveInfo(task.childSessionId, activityLimit);
      activities = live?.activities ?? [];
      activityCount = live?.activityCount ?? 0;
    } catch {
    }
  }

  const transcriptLimit = clampCount(
    input.transcriptLimit,
    SUBAGENT_TRANSCRIPT_DEFAULT_LIMIT,
    SUBAGENT_TRANSCRIPT_MAX_LIMIT,
  );
  const transcript = task.childSessionId && transcriptLimit > 0
    ? await readTranscriptPage(
      task.childSessionId,
      clampOffset(input.transcriptOffset),
      transcriptLimit,
      clampOffset(input.transcriptCharOffset),
    )
    : null;

  return { task: toSubagentTaskView(task), result, activities, activityCount, transcript };
}

export function getSubagentTaskForParent(parentSessionId: string, taskId: string): SubagentTask {
  const row = getSubagentTask(parentSessionId, taskId);
  if (!row) throw new SubagentQueryError(SUBAGENT_TASK_NOT_FOUND);
  return row;
}

export function getSubagentSessionTaskForParent(parentSessionId: string, sessionId: string): SubagentTask {
  const row = listSubagentTasksForChildSession(parentSessionId, sessionId)[0];
  if (!row) throw new SubagentQueryError(SUBAGENT_SESSION_NOT_FOUND);
  return row;
}

export async function getSubagentTaskDetail(input: ReadSubagentTaskInput): Promise<SubagentTaskDetail> {
  const row = getSubagentTaskForParent(input.parentSessionId, input.taskId);
  return readTaskDetail(row, input);
}

export interface ReadSubagentSessionInput {
  parentSessionId: string;
  sessionId: string;
  limit?: number;
  offset?: number;
  resultOffset?: number;
  resultLimit?: number;
  activityLimit?: number;
  transcriptOffset?: number;
  transcriptLimit?: number;
  transcriptCharOffset?: number;
}

export async function getSubagentSessionDetail(input: ReadSubagentSessionInput): Promise<SubagentSessionDetail> {
  const rows = listSubagentTasks(input.parentSessionId)
    .filter((row) => row.childSessionId === input.sessionId);
  if (rows.length === 0) throw new SubagentQueryError(SUBAGENT_SESSION_NOT_FOUND);

  const latest = await readTaskDetail(rows[0], input);
  const limit = clampPageSize(input.limit, SUBAGENT_LIST_DEFAULT_LIMIT, SUBAGENT_LIST_MAX_LIMIT);
  const offset = clampOffset(input.offset);
  const page = rows.slice(offset, offset + limit).map(toSubagentTaskView);
  return {
    sessionId: input.sessionId,
    taskCount: rows.length,
    latest,
    tasks: {
      items: page,
      total: rows.length,
      offset,
      limit,
      hasMore: offset + page.length < rows.length,
    },
  };
}
