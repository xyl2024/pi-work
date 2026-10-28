/**
 * Read-side queries for subagent tasks: what `subagent` `list` / `get` answer,
 * and what the UI endpoints report.
 *
 * Two rules live here so every reader obeys them:
 *
 * 1. **Ownership.** Every lookup takes the calling parent session id and only
 *    ever resolves tasks whose `parent_session_id` matches it. A `task_id` or
 *    `session_id` that belongs to another parent is reported as not found for
 *    *this* parent, so the caller cannot even learn that it exists.
 *
 * 2. **Effective status.** The persisted row is not always the truth: a row can
 *    still say `running` while this process no longer manages the task (the
 *    previous process died mid-task, or the manager never came back for it).
 *    The live task manager is therefore consulted for non-terminal rows, and a
 *    non-terminal row with no live management is reported as `interrupted`.
 *    That is what stops the UI from polling a dead `running` record forever.
 *
 * Reads are bounded: a list never carries prompts, transcripts or full results,
 * and a detail read returns one explicit window plus the offset that continues
 * it (see `sliceSubagentText`).
 */
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
  type SubagentTaskStatus,
} from "../shared/types";
import { getSubagentTask, listSubagentTasks, listSubagentTasksForChildSession, type SubagentTask } from "./subagent-store";
import { getSubagentTaskManager } from "./subagent-tasks";
import { readSessionDetails, readSubagentLiveInfo, summarizeToolInput } from "./sessions/reader";

/** A query the caller may report back as a normal error (unknown / foreign id). */
export class SubagentQueryError extends Error {}

export const SUBAGENT_TASK_NOT_FOUND =
  "No subagent task with that task_id in this session. Only direct subagent tasks of the calling session are readable.";

export const SUBAGENT_SESSION_NOT_FOUND =
  "No subagent session with that session_id in this session. Only direct subagents of the calling session are readable.";

/** Browser-safe summary of one task; never carries prompt, result or transcript. */
export interface SubagentTaskView {
  taskId: string;
  parentSessionId: string;
  childSessionId: string | null;
  subagentName: string;
  description: string;
  /** Effective status (see the module comment), which can differ from the row. */
  status: SubagentTaskStatus;
  error: string | null;
  /** Length of the result text in characters; the text itself stays out. */
  resultLength: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/**
 * The status a caller should believe. Terminal rows are final (a late event
 * must not resurrect them); a non-terminal row is only live when this process
 * still manages the task.
 */
export function resolveSubagentTaskStatus(task: Pick<SubagentTask, "taskId" | "status">): SubagentTaskStatus {
  if (isSubagentTerminalStatus(task.status)) return task.status;
  const live = getSubagentTaskManager().liveStatus(task.taskId);
  // A non-terminal row nobody manages cannot still be running: the manager
  // reconciles stale rows when it starts and removes a task once it finishes.
  return live ?? "interrupted";
}

export function toSubagentTaskView(task: SubagentTask): SubagentTaskView {
  return {
    taskId: task.taskId,
    parentSessionId: task.parentSessionId,
    childSessionId: task.childSessionId,
    subagentName: task.subagentName,
    description: task.description,
    status: resolveSubagentTaskStatus(task),
    error: task.error,
    resultLength: task.result?.length ?? 0,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
  };
}

/** One row of a `list` page: a direct subagent session with its latest task. */
export interface SubagentSessionEntry {
  /**
   * The child session id, or null for a task that never got a session yet
   * (queued, or creating before the child session exists).
   */
  sessionId: string | null;
  /** Newest task of that session (the one `get` by session_id reports). */
  latestTask: SubagentTaskView;
  /** How many tasks this session holds in total. */
  taskCount: number;
}

export interface SubagentSessionList {
  entries: SubagentSessionEntry[];
  /** Matching sessions before paging. */
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  /** Status filter that was applied, if any. */
  status: SubagentTaskStatus | null;
}

export interface ListSubagentSessionsInput {
  parentSessionId: string;
  status?: SubagentTaskStatus;
  limit?: number;
  offset?: number;
}

/** Page size: at least 1, clamped to `max`. */
function clampPageSize(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(value)));
}

/** Optional count (`activity_limit`, `transcript_limit`), where 0 means "none". */
function clampCount(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}

/** An index/offset into a text or a list; never negative. */
function clampOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * Group a parent's tasks into its direct subagent sessions. Rows arrive newest
 * first, so a session appears once, at the position of its newest task, and a
 * long task history never duplicates it.
 */
export function listSubagentSessions(input: ListSubagentSessionsInput): SubagentSessionList {
  const rows = listSubagentTasks(input.parentSessionId);
  const groups = new Map<string, { sessionId: string | null; tasks: SubagentTask[] }>();
  for (const row of rows) {
    // A task without a child session has nothing to group by: it stands alone.
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

/** One transcript message (text blocks only; tool calls become one-line notes). */
export interface SubagentTranscriptMessage {
  role: string;
  text: string;
  /** True when this message is only a window of the full message text. */
  truncated: boolean;
  /** Full text length in characters. */
  totalLength: number;
  /** Characters of the message before `text` (from `transcript_char_offset`). */
  skipped: number;
  /** `transcript_char_offset` that continues this message, or null at the end. */
  nextCharOffset: number | null;
  timestamp: number | null;
}

export interface SubagentTranscriptPage {
  messages: SubagentTranscriptMessage[];
  /** Displayable messages in the child session, before paging. */
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  /** Offset of the next page, or null at the end. */
  nextOffset: number | null;
}

export interface SubagentTaskDetail {
  task: SubagentTaskView;
  /** Bounded window of the completed result / abnormal partial output. */
  result: SubagentTextWindow | null;
  activities: SubagentActivityItem[];
  /** Tool calls in the child session in total, before the activity window. */
  activityCount: number;
  /** Present only when a transcript page was requested and a child exists. */
  transcript: SubagentTranscriptPage | null;
}

export interface SubagentSessionDetail {
  sessionId: string;
  taskCount: number;
  /** Detail of the session's newest task. */
  latest: SubagentTaskDetail;
  /** Paged task history for the session, newest first. */
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
  /** Characters skipped at the start of each transcript message. */
  transcriptCharOffset?: number;
}

/** Readable text of one message: prose blocks, plus one-line notes for tools. */
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
    // A single message can be far larger than a page; the window is explicit
    // and carries the `transcript_char_offset` that continues it.
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

/**
 * Detail of one task. Shared by the `get` action (with the caller's windows) and
 * by the session lookup, so both report the same fields.
 */
async function readTaskDetail(task: SubagentTask, input: Omit<ReadSubagentTaskInput, "parentSessionId" | "taskId">): Promise<SubagentTaskDetail> {
  const result = task.result
    ? sliceSubagentText(
      task.result,
      clampOffset(input.resultOffset),
      clampPageSize(input.resultLimit, SUBAGENT_RESULT_WINDOW_DEFAULT, SUBAGENT_RESULT_WINDOW_MAX),
    )
    : null;

  // The activity window is optional (`0` = don't list any), but the total count
  // is always reported so a zero window never reads as "nothing happened".
  const activityLimit = clampCount(input.activityLimit, SUBAGENT_ACTIVITY_DEFAULT_LIMIT, SUBAGENT_ACTIVITY_MAX_LIMIT);
  let activities: SubagentActivityItem[] = [];
  let activityCount = 0;
  if (task.childSessionId) {
    try {
      const live = await readSubagentLiveInfo(task.childSessionId, activityLimit);
      activities = live?.activities ?? [];
      activityCount = live?.activityCount ?? 0;
    } catch {
      // An unreadable child session is not a query failure: the task detail is
      // still useful without its activity feed.
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

/**
 * The row of one task, enforcing that it belongs to `parentSessionId`. A task
 * of another parent is reported as not found, so the caller cannot learn that
 * it exists. Shared by every id-addressed action (`get`, `wait`, and later
 * `cancel` / `continue`) so ownership is one rule, not one per action.
 */
export function getSubagentTaskForParent(parentSessionId: string, taskId: string): SubagentTask {
  const row = getSubagentTask(taskId);
  if (!row || row.parentSessionId !== parentSessionId) throw new SubagentQueryError(SUBAGENT_TASK_NOT_FOUND);
  return row;
}

/**
 * The newest task of one direct child session of `parentSessionId`, enforcing
 * ownership exactly like `getSubagentTaskForParent`. A child session of another
 * parent is reported as not found. Used by `continue` to resolve the session it
 * must run in; the manager owns the busy decision.
 */
export function getSubagentSessionTaskForParent(parentSessionId: string, sessionId: string): SubagentTask {
  const row = listSubagentTasksForChildSession(parentSessionId, sessionId)[0];
  if (!row) throw new SubagentQueryError(SUBAGENT_SESSION_NOT_FOUND);
  return row;
}

/** Detail for one task id, enforcing that it belongs to `parentSessionId`. */
export async function getSubagentTaskDetail(input: ReadSubagentTaskInput): Promise<SubagentTaskDetail> {
  const row = getSubagentTaskForParent(input.parentSessionId, input.taskId);
  return readTaskDetail(row, input);
}

export interface ReadSubagentSessionInput {
  parentSessionId: string;
  sessionId: string;
  /** Page size for the task history (`list` semantics). */
  limit?: number;
  offset?: number;
  resultOffset?: number;
  resultLimit?: number;
  activityLimit?: number;
  transcriptOffset?: number;
  transcriptLimit?: number;
  transcriptCharOffset?: number;
}

/**
 * Latest task detail plus a paged task history for one direct child session.
 * The session is located through the parent's own tasks, so a session id that
 * belongs to another parent resolves to "not found" here.
 */
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
