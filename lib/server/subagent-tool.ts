import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_SUBAGENT_WAIT_MS,
  MAX_SUBAGENT_WAIT_MS,
  SUBAGENT_ACTIVITY_MAX_LIMIT,
  SUBAGENT_LIST_MAX_LIMIT,
  SUBAGENT_NAME_MAX,
  SUBAGENT_REQUEST_ID_MAX,
  SUBAGENT_RESULT_WINDOW_DEFAULT,
  SUBAGENT_RESULT_WINDOW_MAX,
  SUBAGENT_TOOL_NAME,
  SUBAGENT_TRANSCRIPT_MAX_LIMIT,
  sliceSubagentText,
  type SubagentProfile,
  type SubagentTextWindow,
} from "../shared/subagent";
import {
  isSubagentTerminalStatus,
  type SubagentActivityItem,
  type SubagentTaskStatus,
} from "../shared/types";
import {
  getSubagentTaskManager,
  resolveSubagentTaskConfig,
  SUBAGENT_CANCELLED,
  type SubagentTaskProgress,
  type SubagentTaskWaitResult,
} from "./subagent-tasks";
import { getSubagentProfile, listSubagentProfiles } from "./subagent-profiles";
import { getSubagentTaskByRequestId, type SubagentTask } from "./subagent-store";
import {
  getSubagentSessionDetail,
  getSubagentSessionTaskForParent,
  getSubagentTaskDetail,
  getSubagentTaskForParent,
  listSubagentSessions,
  SubagentQueryError,
  type SubagentSessionDetail,
  type SubagentSessionEntry,
  type SubagentSessionList,
  type SubagentTaskDetail,
  type SubagentTaskView,
} from "./subagent-queries";

export { subagentTools } from "./subagent-tools";
export { resolveSubagentSystemPrompt } from "./subagent-tasks";
export { SUBAGENT_TOOL_NAME };

const MAX_PROMPT_LENGTH = 50_000;

const SUBAGENT_ACTION_SCHEMA = Type.Union(
  [
    Type.Literal("spawn"),
    Type.Literal("list"),
    Type.Literal("get"),
    Type.Literal("wait"),
    Type.Literal("continue"),
    Type.Literal("cancel"),
  ],
  {
    description:
      "Which subagent operation to run. 'spawn' creates and runs a new task; 'continue' starts another turn in an existing child session by session_id and returns a new task_id; 'wait' observes an existing task by task_id without starting or replaying it; 'cancel' asks one task to stop; 'list' lists this session's direct subagent sessions (filter with status, page with limit/offset); 'get' reads one task by task_id or one child session by session_id.",
  },
);
type SubagentActionName = Static<typeof SUBAGENT_ACTION_SCHEMA>;

export interface SubagentParentContext {
  parentSessionId: string;
  model: { provider: string; modelId: string };
  systemPrompt: string | null;
}

export type SubagentParentResolver = (parentSessionId: string) => Promise<SubagentParentContext>;

declare global {
  var __piSubagentParentResolver: SubagentParentResolver | undefined;
}

const liveParentResolver: SubagentParentResolver = async (parentSessionId) => {
  const { getRpcSession } = await import("./rpc-manager");
  const parent = getRpcSession(parentSessionId);
  if (!parent) throw new Error("Parent session is not running");
  if (!parent.isAlive()) throw new Error("Parent session has already stopped");
  const model = parent.inner.model;
  if (!model) throw new Error("The main agent has no active model to inherit");
  return {
    parentSessionId,
    model: { provider: model.provider, modelId: model.id },
    systemPrompt: parent.inner.systemPrompt,
  };
};

function resolveParent(): SubagentParentResolver {
  return globalThis.__piSubagentParentResolver ?? liveParentResolver;
}

export function setSubagentParentResolverForTests(resolver: SubagentParentResolver | null): void {
  globalThis.__piSubagentParentResolver = resolver ?? undefined;
}
const MAX_DESCRIPTION_LENGTH = 200;

const STATUS_PARAM = Type.Union(
  [
    Type.Literal("queued"),
    Type.Literal("creating"),
    Type.Literal("running"),
    Type.Literal("stopping"),
    Type.Literal("completed"),
    Type.Literal("failed"),
    Type.Literal("cancelled"),
    Type.Literal("interrupted"),
  ],
  { description: "list only: only report sessions whose latest task has this status." },
);

export const SubagentParams = Type.Object({
  action: SUBAGENT_ACTION_SCHEMA,
  description: Type.Optional(Type.String({
    minLength: 1,
    maxLength: MAX_DESCRIPTION_LENGTH,
    description: "spawn/continue: a short 3-5 word description of the task",
  })),
  prompt: Type.Optional(Type.String({
    minLength: 1,
    maxLength: MAX_PROMPT_LENGTH,
    description: "spawn/continue: the complete instructions for the subagent (continue: the new turn's input)",
  })),
  subagent_name: Type.Optional(Type.String({
    minLength: 1,
    maxLength: SUBAGENT_NAME_MAX,
    description:
      "spawn only: name of the configured subagent profile to run. See the subagent guidelines in the system prompt for the available names.",
  })),
  wait_ms: Type.Optional(Type.Integer({
    minimum: 0,
    maximum: MAX_SUBAGENT_WAIT_MS,
    description:
      `spawn/continue/wait only: how long to wait for the result. Defaults to ${DEFAULT_SUBAGENT_WAIT_MS} ms; 0 returns immediately.`
      + " When the wait expires the task keeps running and can be observed again later.",
  })),
  request_id: Type.Optional(Type.String({
    minLength: 1,
    maxLength: SUBAGENT_REQUEST_ID_MAX,
    description:
      "spawn/continue only: an optional caller-supplied request id. Retrying with the same id returns the task the first request created instead of starting a second one; use a new id for a new deliberate request. Scoped to this parent session.",
  })),
  status: Type.Optional(STATUS_PARAM),
  limit: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: SUBAGENT_LIST_MAX_LIMIT,
    description:
      "list/get(session_id) only: page size, 1-50 (default 10). get(task_id) ignores it.",
  })),
  offset: Type.Optional(Type.Integer({
    minimum: 0,
    description:
      "list/get(session_id) only: page offset into the session list / task history (default 0).",
  })),
  task_id: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 200,
    description: "get/wait/cancel only: the task id to read, wait for or cancel (from spawn, list or a previous wait result).",
  })),
  session_id: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 200,
    description: "get/continue: the child session id to read (get) or to start another turn in (continue).",
  })),
  result_offset: Type.Optional(Type.Integer({
    minimum: 0,
    description: "get only: character offset into the task result (default 0).",
  })),
  result_limit: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: SUBAGENT_RESULT_WINDOW_MAX,
    description: `get only: characters of result to return, 1-${SUBAGENT_RESULT_WINDOW_MAX} (default ${SUBAGENT_RESULT_WINDOW_DEFAULT}).`,
  })),
  transcript_offset: Type.Optional(Type.Integer({
    minimum: 0,
    description: "get only: message index to start the transcript page at (default 0, oldest first).",
  })),
  transcript_limit: Type.Optional(Type.Integer({
    minimum: 0,
    maximum: SUBAGENT_TRANSCRIPT_MAX_LIMIT,
    description:
      `get only: transcript messages to return, 0-${SUBAGENT_TRANSCRIPT_MAX_LIMIT} (default 0 = don't read the conversation).`,
  })),
  transcript_char_offset: Type.Optional(Type.Integer({
    minimum: 0,
    description:
      "get only: characters to skip at the start of each returned transcript message, for continuing a message that was marked truncated (default 0).",
  })),
  activity_limit: Type.Optional(Type.Integer({
    minimum: 0,
    maximum: SUBAGENT_ACTIVITY_MAX_LIMIT,
    description: `get only: recent tool calls to return, 0-${SUBAGENT_ACTIVITY_MAX_LIMIT} (default 20).`,
  })),
}, { additionalProperties: false });

type SubagentRawParams = Static<typeof SubagentParams>;

const ACTION_KEYS: Record<SubagentActionName, readonly (keyof SubagentRawParams)[]> = {
  spawn: ["description", "prompt", "subagent_name", "wait_ms", "request_id"],
  continue: ["session_id", "description", "prompt", "wait_ms", "request_id"],
  wait: ["task_id", "wait_ms"],
  cancel: ["task_id"],
  list: ["status", "limit", "offset"],
  get: [
    "task_id", "session_id", "limit", "offset",
    "result_offset", "result_limit",
    "transcript_offset", "transcript_limit", "transcript_char_offset", "activity_limit",
  ],
};

interface SubagentReadWindows {
  resultOffset?: number;
  resultLimit?: number;
  activityLimit?: number;
  transcriptOffset?: number;
  transcriptLimit?: number;
  transcriptCharOffset?: number;
}

type ParsedSubagentParams =
  | { action: "spawn"; description: string; prompt: string; subagentName: string; waitMs: number; requestId?: string }
  | {
    action: "continue";
    sessionId: string;
    description: string;
    prompt: string;
    waitMs: number;
    requestId?: string;
  }
  | { action: "wait"; taskId: string; waitMs: number }
  | { action: "cancel"; taskId: string }
  | { action: "list"; status?: SubagentTaskStatus; limit?: number; offset?: number }
  | {
    action: "get";
    target: { kind: "task"; taskId: string } | { kind: "session"; sessionId: string };
    windows: SubagentReadWindows;
    limit?: number;
    offset?: number;
  };

type Parsed = { ok: true; params: ParsedSubagentParams } | { ok: false; error: string };

function isBlank(value: string | undefined): boolean {
  return (value ?? "").trim().length === 0;
}

function normalizeRequestId(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseSubagentParams(raw: SubagentRawParams): Parsed {
  const action = raw.action;
  if (!Object.prototype.hasOwnProperty.call(ACTION_KEYS, action)) {
    return {
      ok: false,
      error: `Unknown action "${String(action)}". Allowed: ${Object.keys(ACTION_KEYS).join(", ")}.`,
    };
  }
  const present = (Object.keys(raw) as (keyof SubagentRawParams)[])
    .filter((key) => key !== "action" && raw[key] !== undefined && raw[key] !== null);
  const foreign = present.filter((key) => !ACTION_KEYS[action].includes(key));
  if (foreign.length > 0) {
    return {
      ok: false,
      error: `action="${action}" does not accept ${foreign.join(", ")}. Allowed: ${ACTION_KEYS[action].join(", ")}.`,
    };
  }

  if (action === "spawn") {
    const missing = (["description", "prompt", "subagent_name"] as const)
      .filter((key) => !present.includes(key));
    if (missing.length > 0) {
      return { ok: false, error: `action="spawn" requires ${missing.join(", ")}.` };
    }
    if (isBlank(raw.description) || isBlank(raw.prompt) || isBlank(raw.subagent_name)) {
      return { ok: false, error: "action=\"spawn\" requires non-empty description, prompt and subagent_name." };
    }
    return {
      ok: true,
      params: {
        action,
        description: raw.description!.trim(),
        prompt: raw.prompt!.trim(),
        subagentName: raw.subagent_name!.trim(),
        waitMs: raw.wait_ms ?? DEFAULT_SUBAGENT_WAIT_MS,
        ...(normalizeRequestId(raw.request_id) ? { requestId: normalizeRequestId(raw.request_id) } : {}),
      },
    };
  }

  if (action === "continue") {
    const missing = (["session_id", "prompt"] as const).filter((key) => !present.includes(key));
    if (missing.length > 0) {
      return { ok: false, error: `action="continue" requires ${missing.join(", ")}.` };
    }
    if (isBlank(raw.session_id) || isBlank(raw.prompt)) {
      return { ok: false, error: 'action="continue" requires a non-empty session_id and prompt.' };
    }
    const prompt = raw.prompt!.trim();
    const derived = prompt.split("\n")[0]!.slice(0, MAX_DESCRIPTION_LENGTH).trim() || "Continue";
    return {
      ok: true,
      params: {
        action,
        sessionId: raw.session_id!.trim(),
        description: raw.description?.trim() || derived,
        prompt,
        waitMs: raw.wait_ms ?? DEFAULT_SUBAGENT_WAIT_MS,
        ...(normalizeRequestId(raw.request_id) ? { requestId: normalizeRequestId(raw.request_id) } : {}),
      },
    };
  }

  if (action === "list") {
    return { ok: true, params: { action, status: raw.status, limit: raw.limit, offset: raw.offset } };
  }

  if (action === "wait") {
    const taskId = raw.task_id?.trim() ?? "";
    if (!taskId) return { ok: false, error: 'action="wait" requires task_id (the task to observe).' };
    return {
      ok: true,
      params: { action, taskId, waitMs: raw.wait_ms ?? DEFAULT_SUBAGENT_WAIT_MS },
    };
  }

  if (action === "cancel") {
    const taskId = raw.task_id?.trim() ?? "";
    if (!taskId) return { ok: false, error: 'action="cancel" requires task_id (the task to cancel).' };
    return { ok: true, params: { action, taskId } };
  }

  const taskId = raw.task_id?.trim() ?? "";
  const sessionId = raw.session_id?.trim() ?? "";
  if (!taskId && !sessionId) {
    return { ok: false, error: 'action="get" requires exactly one of task_id or session_id (none was given).' };
  }
  if (taskId && sessionId) {
    return { ok: false, error: 'action="get" takes either task_id (one task) or session_id (one child session), not both.' };
  }
  if (taskId && (raw.limit !== undefined || raw.offset !== undefined)) {
    return { ok: false, error: 'limit/offset page a session\'s task history; drop them when using task_id.' };
  }
  return {
    ok: true,
    params: {
      action,
      target: taskId ? { kind: "task", taskId } : { kind: "session", sessionId },
      windows: {
        resultOffset: raw.result_offset,
        resultLimit: raw.result_limit,
        activityLimit: raw.activity_limit,
        transcriptOffset: raw.transcript_offset,
        transcriptLimit: raw.transcript_limit,
        transcriptCharOffset: raw.transcript_char_offset,
      },
      limit: raw.limit,
      offset: raw.offset,
    },
  };
}

export interface SubagentObservedDetails {
  taskId: string;
  childSessionId: string | null;
  status: SubagentTaskStatus;
  subagentName: string;
  description: string;
  waitExpired: boolean;
  result?: string;
  resultTruncated?: boolean;
  resultNextOffset?: number;
  error?: string;
}

export interface SubagentSpawnDetails extends SubagentObservedDetails {
  action: "spawn";
}

export interface SubagentWaitDetails extends SubagentObservedDetails {
  action: "wait";
}

export interface SubagentContinueDetails extends SubagentObservedDetails {
  action: "continue";
}

export interface SubagentCancelDetails {
  action: "cancel";
  taskId: string;
  childSessionId: string | null;
  status: SubagentTaskStatus;
  requested: boolean;
  waitExpired?: boolean;
  result?: string;
  resultTruncated?: boolean;
  resultNextOffset?: number;
  error?: string;
}

export interface SubagentListDetails {
  action: "list";
  entries: SubagentSessionEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  status: SubagentTaskStatus | null;
}

export interface SubagentGetDetails {
  action: "get";
  target: "task" | "session";
  detail: SubagentTaskDetail;
  tasks?: SubagentSessionDetail["tasks"];
}

export interface SubagentQueryErrorDetails {
  action: "list" | "get" | "wait" | "continue" | "cancel";
  error: string;
}

export type SubagentToolDetails =
  | SubagentSpawnDetails
  | SubagentWaitDetails
  | SubagentContinueDetails
  | SubagentCancelDetails
  | SubagentListDetails
  | SubagentGetDetails
  | SubagentQueryErrorDetails;

function spawnProgressDetails(
  progress: SubagentTaskProgress,
): SubagentSpawnDetails {
  return {
    action: "spawn",
    taskId: progress.taskId,
    childSessionId: progress.childSessionId,
    status: progress.status,
    subagentName: progress.subagentName,
    description: progress.description,
    waitExpired: false,
  };
}

function continueProgressDetails(
  progress: SubagentTaskProgress,
): SubagentContinueDetails {
  return {
    action: "continue",
    taskId: progress.taskId,
    childSessionId: progress.childSessionId,
    status: progress.status,
    subagentName: progress.subagentName,
    description: progress.description,
    waitExpired: false,
  };
}

function targetOf(task: Pick<SubagentTaskWaitResult, "taskId" | "childSessionId">): string {
  return task.childSessionId
    ? `task ${task.taskId}, session ${task.childSessionId}`
    : `task ${task.taskId}`;
}

function boundedResult(text: string | null): SubagentTextWindow | null {
  return text ? sliceSubagentText(text, 0, SUBAGENT_RESULT_WINDOW_DEFAULT) : null;
}

function resultFields(
  window: SubagentTextWindow | null,
): Pick<SubagentObservedDetails, "result" | "resultTruncated" | "resultNextOffset"> {
  if (!window) return {};
  return {
    result: window.text,
    ...(window.truncated
      ? { resultTruncated: true, resultNextOffset: window.nextOffset ?? undefined }
      : {}),
  };
}

function resultContinuation(taskId: string, window: SubagentTextWindow): string {
  return `read the rest with action="get", task_id="${taskId}", result_offset=${window.nextOffset}.`;
}

function truncationNote(taskId: string, window: SubagentTextWindow): string {
  const end = window.offset + window.text.length;
  return `[truncated] The stored result is ${window.total} chars; chars ${window.offset}-${end} are shown`
    + ` and ${window.remaining} follow. To continue, ${resultContinuation(taskId, window)}`;
}

function waitResultEnvelope(
  action: "spawn" | "wait" | "continue",
  task: SubagentTaskWaitResult,
  waitMs: number,
) {
  const window = boundedResult(task.result);
  const details: SubagentSpawnDetails | SubagentWaitDetails | SubagentContinueDetails = {
    action,
    taskId: task.taskId,
    childSessionId: task.childSessionId,
    status: task.status,
    subagentName: task.subagentName,
    description: task.description,
    waitExpired: task.waitExpired,
    ...resultFields(window),
    ...(task.error ? { error: task.error } : {}),
  } as SubagentSpawnDetails | SubagentWaitDetails | SubagentContinueDetails;

  let text: string;
  if (task.status === "completed") {
    text = `Subagent completed (${targetOf(task)}).\n\n${window?.text || "(no result)"}`;
    if (window?.truncated) text += `\n\n${truncationNote(task.taskId, window)}`;
  } else if (task.waitExpired && !isSubagentTerminalStatus(task.status)) {
    const waited = waitMs >= 1000 ? `${Math.round(waitMs / 1000)}s` : `${waitMs}ms`;
    text = `Subagent is still ${task.status} after ${waited} (${targetOf(task)}).`
      + " The task keeps running in the background; it was not cancelled and its runtime limit is unaffected."
      + ` Observe it again with action="wait", task_id="${task.taskId}".`;
  } else if (isSubagentTerminalStatus(task.status)) {
    const partial = window
      ? `\n\nLast partial output:\n${window.text}`
        + (window.truncated ? `\n\n${truncationNote(task.taskId, window)}` : "")
      : "";
    const reason = task.error ?? (task.status === "interrupted"
      ? "The task is no longer managed by this process, so it cannot still be running."
      : "Unknown error");
    text = `Subagent ${task.status} (${targetOf(task)}).\n\n${reason}${partial}`;
  } else if (task.status === "stopping") {
    text = `Subagent is stopping (${targetOf(task)}).`
      + " The stop was requested but has not been confirmed by the session yet."
      + ` Observe it again with action="wait", task_id="${task.taskId}".`;
  } else {
    text = `Subagent is ${task.status} (${targetOf(task)}).`
      + " The wait was cancelled; the task was not cancelled and keeps running with its runtime limit unaffected."
      + ` Observe it again with action="wait", task_id="${task.taskId}".`;
  }

  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function spawnErrorEnvelope(input: {
  subagentName: string;
  description: string;
  error: string;
  taskId?: string;
  childSessionId?: string | null;
}): { content: Array<{ type: "text"; text: string }>; details: SubagentSpawnDetails; isError: true } {
  const taskId = input.taskId ?? "";
  return {
    content: [{ type: "text" as const, text: input.error }],
    details: {
      action: "spawn",
      taskId,
      childSessionId: input.childSessionId ?? null,
      status: "failed",
      subagentName: input.subagentName,
      description: input.description,
      waitExpired: false,
      error: input.error,
    },
    isError: true,
  };
}

function queryErrorEnvelope(
  action: "list" | "get" | "wait" | "continue" | "cancel",
  error: string,
): { content: Array<{ type: "text"; text: string }>; details: SubagentQueryErrorDetails; isError: true } {
  return {
    content: [{ type: "text" as const, text: error }],
    details: { action, error },
    isError: true,
  };
}

function cancelEnvelope(row: SubagentTask, requested: boolean) {
  const target = row.childSessionId ? `task ${row.taskId}, session ${row.childSessionId}` : `task ${row.taskId}`;
  let text: string;
  if (!requested) {
    text = `Subagent task ${row.taskId} is already ${row.status}; the late cancel request left it and its result untouched.`;
  } else if (row.status === "stopping") {
    text = `Cancel requested for subagent ${target}. The task is stopping and becomes cancelled only once the child session confirms the turn stopped; its slot stays held until then.`
      + ` Confirm with action="wait", task_id="${row.taskId}".`;
  } else if (row.status === "cancelled") {
    text = `Subagent ${target} was cancelled before it started (it never ran a turn).`;
  } else {
    text = `Cancel requested for subagent ${target}; it is currently ${row.status}.`
      + ` Confirm with action="wait", task_id="${row.taskId}".`;
  }
  return {
    content: [{ type: "text" as const, text }],
    details: {
      action: "cancel" as const,
      taskId: row.taskId,
      childSessionId: row.childSessionId,
      status: row.status,
      requested,
      waitExpired: !isSubagentTerminalStatus(row.status),
      ...resultFields(boundedResult(row.result)),
      ...(row.error ? { error: row.error } : {}),
    },
  };
}

function iso(ms: number | null): string {
  return ms === null ? "—" : new Date(ms).toISOString();
}

function clock(ms: number | null): string {
  return ms === null ? "--:--:--" : iso(ms).slice(11, 19);
}

function taskSummaryLine(view: SubagentTaskView): string {
  const session = view.childSessionId ?? "(no child session yet)";
  const error = view.error ? ` — error: ${view.error}` : "";
  const origin = view.origin === "manual" ? " — manual input by the user" : "";
  return `${session} — ${view.status} — ${view.subagentName} — "${view.description}"${origin}`
    + ` — task ${view.taskId} — created ${iso(view.createdAt)}${error}`;
}

function listEntryLines(entry: SubagentSessionEntry, position: number): string[] {
  const view = entry.latestTask;
  const lines = [
    `${position}. session_id: ${entry.sessionId ?? "(none yet — the latest task has no child session, it is still queued or creating)"}`,
    `   status: ${view.status}${entry.taskCount > 1 ? " (of the latest task)" : ""}`,
    `   subagent: ${view.subagentName}`,
    `   description: "${view.description.replace(/\s+/g, " ")}"`,
    `   latest_task_id: ${view.taskId}`,
    `   tasks: ${entry.taskCount} in this session${entry.taskCount > 1 ? " (the info above is the newest one)" : ""}`,
    `   created: ${iso(view.createdAt)}`,
  ];
  if (view.origin === "manual") lines.push("   origin: manual — the user typed this input into the child session");
  if (view.error) lines.push(`   error: ${view.error}`);
  return lines;
}

function listText(list: SubagentSessionList): string {
  const lines: string[] = [];
  const filter = list.status ? ` (filter: status=${list.status})` : "";
  if (list.entries.length === 0) {
    lines.push(`No subagent sessions of this session${list.status ? ` with status=${list.status}` : ""} were found.`);
    if (list.offset > 0) {
      lines.push(`The page offset ${list.offset} is past the end; call action="list" with offset=0 to start over.`);
    }
  } else {
    const first = list.offset + 1;
    const last = list.offset + list.entries.length;
    lines.push(`Subagent sessions of this session: ${list.total} in total${filter}, newest first.`);
    lines.push(`Page: entries ${first}-${last} of ${list.total} (offset=${list.offset}, limit=${list.limit}).`);
    list.entries.forEach((entry, index) => {
      lines.push("", ...listEntryLines(entry, list.offset + index + 1));
    });
  }
  if (list.hasMore) {
    const nextOffset = list.offset + list.entries.length;
    lines.push(
      "",
      `${list.total - nextOffset} more session(s): call action="list" with offset=${nextOffset}`
      + `${list.status ? ` and status="${list.status}"` : ""} to read the next page.`,
    );
  } else if (list.entries.length > 0) {
    lines.push("", `That is the last page. All ${list.total} session(s) are shown.`);
  }
  lines.push(
    'Use action="get" with task_id (one task) or session_id (newest task detail plus task history) for status, timing, error, recent activity, result and transcript.',
  );
  return lines.join("\n");
}

function resultBlock(detail: SubagentTaskDetail): string[] {
  const task = detail.task;
  const window = detail.result;
  if (!window) {
    if (task.status === "completed") return ["  result: (empty)"];
    if (isSubagentTerminalStatus(task.status)) return [`  result: none (${task.status} before any output)`];
    return ["  result: not available yet — the task has not finished."];
  }
  const range = `${window.offset}-${window.offset + window.text.length}`;
  let header: string;
  if (!window.truncated) {
    header = `  result (${window.total} chars, complete):`;
  } else {
    const bits = [`chars ${range} of ${window.total}`];
    if (window.remaining > 0) bits.push(`${window.remaining} more`);
    if (window.skipped > 0) bits.push(`${window.skipped} skipped`);
    header = `  result (${bits.join("; ")}; truncated):`;
  }
  const lines = [header, window.text || "(empty)"];
  if (window.remaining > 0 && window.nextOffset !== null) {
    lines.push(`  [truncated] ${resultContinuation(task.taskId, window)}`);
  } else if (window.skipped > 0 && window.text.length === 0) {
    lines.push(`  result_offset ${window.skipped} is at/after the end of the ${window.total} chars; use result_offset=0 to read it again.`);
  }
  return lines;
}

function activityBlock(detail: SubagentTaskDetail): string[] {
  if (!detail.task.childSessionId) return [];
  if (detail.activityCount === 0) return ["  recent tool activity: none recorded."];
  if (detail.activities.length === 0) {
    return [`  recent tool activity: not shown (activity_limit=0; ${detail.activityCount} recorded in total).`];
  }
  const lines: string[] = [];
  const omitted = detail.activityCount - detail.activities.length;
  lines.push(
    `  recent tool activity (${detail.activities.length} of ${detail.activityCount}, oldest first`
    + `${omitted > 0 ? `, ${omitted} earlier omitted` : ""}):`,
  );
  for (const activity of detail.activities) {
    lines.push(`    ${clock(activity.timestamp)} ${activityLine(activity)}`);
  }
  return lines;
}

function activityLine(activity: SubagentActivityItem): string {
  return activity.summary ? `${activity.toolName} ${activity.summary}` : activity.toolName;
}

function transcriptBlock(detail: SubagentTaskDetail): string[] {
  const page = detail.transcript;
  const task = detail.task;
  if (!page) {
    return task.childSessionId
      ? [
        `  transcript: not requested. Add transcript_limit (1-${SUBAGENT_TRANSCRIPT_MAX_LIMIT})`
        + ' and transcript_offset to action="get" to read the conversation.',
      ]
      : [];
  }
  const lines: string[] = [];
  if (page.messages.length === 0) {
    lines.push(`  transcript: no messages at offset ${page.offset} (${page.total} message(s) in total).`);
    return lines;
  }
  lines.push(
    `  transcript (messages ${page.offset}-${page.offset + page.messages.length - 1} of ${page.total}`,
  );
  lines[0] += ", oldest first):";
  page.messages.forEach((message, index) => {
    const tail = message.truncated
      ? ` … [truncated: ${message.totalLength} chars in total`
        + `${message.nextCharOffset === null ? ", end of message" : ", more follows"}]`
      : "";
    lines.push(`    [${page.offset + index}] ${message.role}: ${message.text || "(no text)"}${tail}`);
    if (message.truncated && message.nextCharOffset !== null) {
      lines.push(
        `      read the rest of message ${page.offset + index} with action="get", task_id="${task.taskId}",`
        + ` transcript_offset=${page.offset + index}, transcript_limit=1, transcript_char_offset=${message.nextCharOffset}.`,
      );
    } else if (message.skipped > 0 && message.text.length === 0) {
      lines.push(`      transcript_char_offset ${message.skipped} is at/after the end of this ${message.totalLength}-char message; use transcript_char_offset=0.`);
    }
  });
  if (page.nextOffset !== null) {
    lines.push(
      `  ${page.total - page.nextOffset} message(s) follow: action="get", task_id="${task.taskId}"`
      + `, transcript_offset=${page.nextOffset}, transcript_limit=${page.limit}.`,
    );
  }
  return lines;
}

function taskDetailLines(detail: SubagentTaskDetail): string[] {
  const task = detail.task;
  const lines: string[] = [];
  lines.push(`Subagent task ${task.taskId} — ${task.status}`);
  lines.push(`  subagent: ${task.subagentName}`);
  lines.push(`  description: ${task.description}`);
  lines.push(task.origin === "manual"
    ? "  origin: manual — the user typed this input into the child session (same task rules as a delegation)"
    : "  origin: tool — this session delegated the input");
  lines.push(`  session: ${task.childSessionId ?? "(no child session yet — the task has not started)"}`);
  const timing = [`created ${iso(task.createdAt)}`];
  if (task.startedAt !== null) timing.push(`started ${iso(task.startedAt)}`);
  if (task.finishedAt !== null) timing.push(`finished ${iso(task.finishedAt)}`);
  lines.push(`  ${timing.join(", ")}`);
  if (task.error) lines.push(`  error: ${task.error}`);
  lines.push(...resultBlock(detail));
  lines.push(...activityBlock(detail));
  lines.push(...transcriptBlock(detail));
  return lines;
}

function historyBlock(session: SubagentSessionDetail): string[] {
  const page = session.tasks;
  if (page.items.length === 0) {
    return [`  task history: no tasks at offset ${page.offset} (${page.total} in total).`];
  }
  const lines = [
    `  task history (${page.offset + 1}-${page.offset + page.items.length} of ${page.total}, newest first):`,
  ];
  page.items.forEach((item, index) => {
    lines.push(`    ${page.offset + index + 1}. ${taskSummaryLine(item)}`);
  });
  if (page.hasMore) {
    const nextOffset = page.offset + page.items.length;
    lines.push(
      `  ${page.total - nextOffset} older task(s): action="get", session_id="${session.sessionId}", offset=${nextOffset}.`,
    );
  }
  lines.push('  Use action="get" with task_id=<id> for the full detail of any task in this history.');
  return lines;
}

function listEnvelope(list: SubagentSessionList) {
  return {
    content: [{ type: "text" as const, text: listText(list) }],
    details: {
      action: "list" as const,
      entries: list.entries,
      total: list.total,
      offset: list.offset,
      limit: list.limit,
      hasMore: list.hasMore,
      status: list.status,
    },
  };
}

function taskDetailEnvelope(detail: SubagentTaskDetail) {
  return {
    content: [{ type: "text" as const, text: taskDetailLines(detail).join("\n") }],
    details: { action: "get" as const, target: "task" as const, detail },
  };
}

function sessionDetailEnvelope(session: SubagentSessionDetail) {
  const header = `Subagent session ${session.sessionId} — ${session.taskCount} task(s), newest first`;
  const lines = [
    header,
    "",
    ...taskDetailLines(session.latest),
    ...historyBlock(session),
  ];
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: {
      action: "get" as const,
      target: "session" as const,
      detail: session.latest,
      tasks: session.tasks,
    },
  };
}

export function buildSubagentSystemPromptBlock(
  profiles: readonly SubagentProfile[] = listSubagentProfiles(),
): string {
  const catalog = profiles.length > 0
    ? profiles.map((profile) => `  - \`${profile.name}\`: ${profile.description}`).join("\n")
    : "  - (no subagents are configured yet; ask the user to create one in Settings → Subagents)";
  return `\
## Subagent tool \`subagent\`
- Delegate independent, well-scoped tasks to a subagent; emit several \`subagent\` calls in ONE message when the tasks do not depend on each other.
- \`subagent_name\` selects one of the configured subagents:
${catalog}
- Prefer a read-only explorer over exploring the codebase yourself; when you hand a subagent a change, files or a question to review, state the standards to judge against.
- An expired \`wait\` has only ended the observation: the task is still running, not failed and not cancelled. Call \`action: "wait"\` again to observe it.
`;
}

const TOOL_DESCRIPTION =
  "Manage subagent tasks: spawn, wait, continue, list, get or cancel one persistent child session.";

export const subagentTool = defineTool<typeof SubagentParams, SubagentToolDetails>({
  name: SUBAGENT_TOOL_NAME,
  label: "Subagent",
  description: TOOL_DESCRIPTION,
  parameters: SubagentParams,
  promptSnippet: "Delegate a focused task to a specialized subagent, then observe, continue or cancel it.",
  async execute(_toolCallId, params, signal, onUpdate, ctx) {
    const parsed = parseSubagentParams(params);
    if (!parsed.ok) {
      const action = params.action;
      if (action === "list" || action === "get" || action === "wait" || action === "continue" || action === "cancel") {
        return queryErrorEnvelope(action, parsed.error);
      }
      return spawnErrorEnvelope({
        subagentName: params.subagent_name ?? "",
        description: params.description ?? "",
        error: parsed.error,
      });
    }

    const parentSessionId = ctx.sessionManager.getSessionId();
    const input = parsed.params;

    if (input.action === "spawn" && input.requestId) {
      const existing = getSubagentTaskByRequestId(parentSessionId, input.requestId);
      if (existing) {
        if (existing.subagentName !== input.subagentName || existing.prompt !== input.prompt) {
          return spawnErrorEnvelope({
            subagentName: input.subagentName,
            description: input.description,
            error:
              `request_id "${input.requestId}" was already used for a different request; use a new request_id for this spawn.`,
          });
        }
        const manager = getSubagentTaskManager();
        const result = await manager.wait(existing.parentSessionId, existing.taskId, {
          timeoutMs: input.waitMs,
          ...(signal ? { stopOnAbort: { signal, reason: SUBAGENT_CANCELLED } } : {}),
        });
        return waitResultEnvelope("spawn", result, input.waitMs);
      }
    }

    if (input.action === "continue") {
      try {
        getSubagentSessionTaskForParent(parentSessionId, input.sessionId);
        const manager = getSubagentTaskManager();
        const task = manager.continue({
          parentSessionId,
          childSessionId: input.sessionId,
          description: input.description,
          prompt: input.prompt,
          ...(input.requestId ? { requestId: input.requestId } : {}),
          onProgress: (progress) => {
            onUpdate?.({ content: [], details: continueProgressDetails(progress) });
          },
        });
        const result = await manager.wait(parentSessionId, task.taskId, {
          timeoutMs: input.waitMs,
          ...(signal ? { stopOnAbort: { signal, reason: SUBAGENT_CANCELLED } } : {}),
        });
        return waitResultEnvelope("continue", result, input.waitMs);
      } catch (error) {
        if (error instanceof SubagentQueryError) return queryErrorEnvelope("continue", error.message);
        return queryErrorEnvelope("continue", error instanceof Error ? error.message : String(error));
      }
    }

    if (input.action === "wait") {
      try {
        getSubagentTaskForParent(parentSessionId, input.taskId);
        const manager = getSubagentTaskManager();
        const result = await manager.wait(parentSessionId, input.taskId, {
          timeoutMs: input.waitMs,
          ...(signal ? { observeAbort: signal } : {}),
        });
        return waitResultEnvelope("wait", result, input.waitMs);
      } catch (error) {
        if (error instanceof SubagentQueryError) return queryErrorEnvelope("wait", error.message);
        return queryErrorEnvelope("wait", error instanceof Error ? error.message : String(error));
      }
    }

    if (input.action === "cancel") {
      try {
        const before = getSubagentTaskForParent(parentSessionId, input.taskId);
        const manager = getSubagentTaskManager();
        const wasTerminal = isSubagentTerminalStatus(before.status);
        if (!wasTerminal) {
          manager.stop(parentSessionId, input.taskId, SUBAGENT_CANCELLED);
        }
        const after = manager.get(parentSessionId, input.taskId) ?? before;
        const requested = !wasTerminal && (after.status === "stopping" || after.status === "cancelled");
        return cancelEnvelope(after, requested);
      } catch (error) {
        if (error instanceof SubagentQueryError) return queryErrorEnvelope("cancel", error.message);
        return queryErrorEnvelope("cancel", error instanceof Error ? error.message : String(error));
      }
    }

    if (input.action === "list") {
      try {
        const list = listSubagentSessions({
          parentSessionId,
          status: input.status,
          limit: input.limit,
          offset: input.offset,
        });
        return listEnvelope(list);
      } catch (error) {
        return queryErrorEnvelope("list", error instanceof Error ? error.message : String(error));
      }
    }

    if (input.action === "get") {
      try {
        if (input.target.kind === "task") {
          const detail = await getSubagentTaskDetail({
            parentSessionId,
            taskId: input.target.taskId,
            ...input.windows,
          });
          return taskDetailEnvelope(detail);
        }
        const session = await getSubagentSessionDetail({
          parentSessionId,
          sessionId: input.target.sessionId,
          ...input.windows,
          limit: input.limit,
          offset: input.offset,
        });
        return sessionDetailEnvelope(session);
      } catch (error) {
        if (error instanceof SubagentQueryError) return queryErrorEnvelope("get", error.message);
        return queryErrorEnvelope("get", error instanceof Error ? error.message : String(error));
      }
    }

    const { description, prompt, subagentName, waitMs } = input;
    const profile = getSubagentProfile(subagentName);
    if (!profile) {
      const available = listSubagentProfiles().map((candidate) => candidate.name);
      return spawnErrorEnvelope({
        subagentName,
        description,
        error: `Unknown subagent_name "${subagentName}". Available subagents: ${
          available.length > 0 ? available.join(", ") : "(none configured)"
        }.`,
      });
    }

    try {
      const parent = await resolveParent()(parentSessionId);

      const config = resolveSubagentTaskConfig({
        profile,
        cwd: ctx.cwd,
        parentModel: parent.model,
        parentSystemPrompt: profile.inheritSystemPrompt ? parent.systemPrompt : null,
      });

      const manager = getSubagentTaskManager();
      const task = manager.spawn({
        parentSessionId: parent.parentSessionId,
        description,
        prompt,
        config,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        onProgress: (progress) => {
          onUpdate?.({ content: [], details: spawnProgressDetails(progress) });
        },
      });

      const result = await manager.wait(parentSessionId, task.taskId, {
        timeoutMs: waitMs,
        ...(signal ? { stopOnAbort: { signal, reason: SUBAGENT_CANCELLED } } : {}),
      });

      return waitResultEnvelope("spawn", result, waitMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return spawnErrorEnvelope({ subagentName: profile.name, description, error: message });
    }
  },
});
