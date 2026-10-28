/**
 * The `subagent` agent tool.
 *
 * One tool, action-discriminated parameters. This issue ships `spawn`, `list`
 * and `get`:
 *
 * - `spawn` resolves a profile, freezes the child configuration, hands the task
 *   to the task manager and then *waits* (15 minutes by default, 0 for an
 *   immediate return) for an answer. The wait is only an observation — when it
 *   expires the task keeps running under the manager, its result stays
 *   collectable, and the parent turn can finish normally.
 * - `list` finds the calling session's direct subagent sessions again, one row
 *   per child session with its newest task, filterable by status and pageable.
 * - `get` reads one task by `task_id`, or one child session by `session_id`
 *   (newest task detail plus a paged task history). Results and transcripts are
 *   returned as explicit bounded windows that say how to read the rest.
 *
 * The parent id always comes from the call context, never from the arguments,
 * so a child can only ever see the tasks its own session created.
 *
 * The previous `spawn_subagent` name is deliberately not registered: stored
 * tool selections are migrated on load (`lib/server/session-tools-config.ts`,
 * `lib/server/cwd-tools-config.ts`) and old messages stay readable because the
 * display layer recognises both names.
 */
import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_SUBAGENT_WAIT_MS,
  MAX_SUBAGENT_WAIT_MS,
  SUBAGENT_ACTIVITY_MAX_LIMIT,
  SUBAGENT_LIST_MAX_LIMIT,
  SUBAGENT_NAME_MAX,
  SUBAGENT_RESULT_WINDOW_MAX,
  SUBAGENT_TOOL_NAME,
  SUBAGENT_TRANSCRIPT_MAX_LIMIT,
  type SubagentProfile,
} from "../shared/subagent";
import {
  MAX_CONCURRENT_SUBAGENT_RUNS,
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
import {
  getSubagentSessionDetail,
  getSubagentTaskDetail,
  listSubagentSessions,
  SubagentQueryError,
  type SubagentSessionDetail,
  type SubagentSessionEntry,
  type SubagentSessionList,
  type SubagentTaskDetail,
  type SubagentTaskView,
} from "./subagent-queries";

// Re-exported from its new home so existing importers (tests, rpc-manager) keep
// resolving the default tool set through the tool module.
export { subagentTools } from "./subagent-tools";
// Re-exported for the tests that have always imported the prompt rule from the
// tool module; the rule itself lives with the task config it feeds.
export { resolveSubagentSystemPrompt } from "./subagent-tasks";
export { SUBAGENT_TOOL_NAME };

const MAX_PROMPT_LENGTH = 50_000;

/**
 * The actions this tool ships so far. `ACTION_KEYS` is a Record over this
 * union, so adding an action here without its argument allowlist fails to
 * compile; later lifecycle tickets extend both in one place.
 */
const SUBAGENT_ACTION_SCHEMA = Type.Union(
  [Type.Literal("spawn"), Type.Literal("list"), Type.Literal("get")],
  {
    description:
      "Which subagent operation to run. 'spawn' creates and runs a new task; 'list' lists this session's direct subagent sessions (filter with status, page with limit/offset); 'get' reads one task by task_id or one child session by session_id.",
  },
);
type SubagentActionName = Static<typeof SUBAGENT_ACTION_SCHEMA>;

/** The parent facts a spawn needs, resolved from the live registry. */
export interface SubagentParentContext {
  parentSessionId: string;
  model: { provider: string; modelId: string };
  /** The parent's rendered system prompt, for profiles that inherit it. */
  systemPrompt: string | null;
}

/** How the tool learns its parent. Tests substitute this seam. */
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

/** Test seam: replace / clear the parent resolver. */
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

/**
 * One flat parameter object with an action discriminator, in the same shape as
 * the other multi-action tool (`pi-work-call`). Keeping one provider-facing
 * object (instead of a root-level `anyOf` of per-action objects) is deliberate:
 * providers disagree about root unions. The per-action *structure* is still
 * enforced — every action has its own argument allowlist and required set in
 * `parseSubagentParams`, which names the missing / unexpected argument instead
 * of leaving the model with a generic schema error.
 */
export const SubagentParams = Type.Object({
  action: SUBAGENT_ACTION_SCHEMA,
  // spawn
  description: Type.Optional(Type.String({
    minLength: 1,
    maxLength: MAX_DESCRIPTION_LENGTH,
    description: "spawn only: a short 3-5 word description of the task",
  })),
  prompt: Type.Optional(Type.String({
    minLength: 1,
    maxLength: MAX_PROMPT_LENGTH,
    description: "spawn only: the complete instructions for the subagent",
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
      `spawn only: how long to wait for the result. Defaults to ${DEFAULT_SUBAGENT_WAIT_MS} ms; 0 returns immediately.`
      + " When the wait expires the task keeps running and can be observed again later.",
  })),
  // list
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
  // get
  task_id: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 200,
    description: "get only: the task id to read (e.g. from spawn, list or the wait result).",
  })),
  session_id: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 200,
    description: "get only: the child session id to read (newest task detail plus task history).",
  })),
  result_offset: Type.Optional(Type.Integer({
    minimum: 0,
    description: "get only: character offset into the task result (default 0).",
  })),
  result_limit: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: SUBAGENT_RESULT_WINDOW_MAX,
    description: `get only: characters of result to return, 1-${SUBAGENT_RESULT_WINDOW_MAX} (default 4000).`,
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

/** The parsed shape is exactly the schema's: one type, no hand-mirrored twin. */
type SubagentRawParams = Static<typeof SubagentParams>;

/** Which parameters each action accepts; anything else is rejected by name. */
const ACTION_KEYS: Record<SubagentActionName, readonly (keyof SubagentRawParams)[]> = {
  spawn: ["description", "prompt", "subagent_name", "wait_ms"],
  list: ["status", "limit", "offset"],
  get: [
    "task_id", "session_id", "limit", "offset",
    "result_offset", "result_limit",
    "transcript_offset", "transcript_limit", "transcript_char_offset", "activity_limit",
  ],
};

/** Windows shared by task and session lookups. */
interface SubagentReadWindows {
  resultOffset?: number;
  resultLimit?: number;
  activityLimit?: number;
  transcriptOffset?: number;
  transcriptLimit?: number;
  transcriptCharOffset?: number;
}

type ParsedSubagentParams =
  | { action: "spawn"; description: string; prompt: string; subagentName: string; waitMs: number }
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

/**
 * Per-action validation. The schema already bounds each field that is present;
 * this adds the cross-field rules the schema cannot express (required arguments,
 * exactly one lookup id, arguments that belong to another action).
 */
export function parseSubagentParams(raw: SubagentRawParams): Parsed {
  const action = raw.action;
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
      },
    };
  }

  if (action === "list") {
    return { ok: true, params: { action, status: raw.status, limit: raw.limit, offset: raw.offset } };
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
    // Paging only applies to a session's task history; a task lookup has one row.
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

/** Details carried on the tool result and on every in-flight progress update. */
export interface SubagentSpawnDetails {
  action: "spawn";
  taskId: string;
  childSessionId: string | null;
  /** Non-terminal while the caller only observed a part of the task's life. */
  status: SubagentTaskStatus;
  subagentName: string;
  description: string;
  /** True when the caller's wait ran out and the task is still unfinished. */
  waitExpired: boolean;
  /** Completed result, or the last partial output of an abnormal stop. */
  result?: string;
  error?: string;
}

export interface SubagentListDetails {
  action: "list";
  entries: SubagentSessionEntry[];
  /** Matching sessions before paging. */
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  /** Status filter that was applied, if any. */
  status: SubagentTaskStatus | null;
}

export interface SubagentGetDetails {
  action: "get";
  /** Which identifier located the target. */
  target: "task" | "session";
  /** The located task's detail (the newest task for a session lookup). */
  detail: SubagentTaskDetail;
  /** Session lookups only: the paged task history. */
  tasks?: SubagentSessionDetail["tasks"];
}

export interface SubagentQueryErrorDetails {
  action: "list" | "get";
  error: string;
}

export type SubagentToolDetails =
  | SubagentSpawnDetails
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

function targetOf(task: Pick<SubagentTaskWaitResult, "taskId" | "childSessionId">): string {
  return task.childSessionId
    ? `task ${task.taskId}, session ${task.childSessionId}`
    : `task ${task.taskId}`;
}

/**
 * The model-facing text. Deliberately explicit about which of the two limits
 * expired (wait vs. runtime) and about the task still being alive, so the
 * parent never mistakes a wait timeout for a failed task.
 */
function waitResultEnvelope(task: SubagentTaskWaitResult, waitMs: number) {
  const details: SubagentSpawnDetails = {
    action: "spawn",
    taskId: task.taskId,
    childSessionId: task.childSessionId,
    status: task.status,
    subagentName: task.subagentName,
    description: task.description,
    waitExpired: task.waitExpired,
    ...(task.result ? { result: task.result } : {}),
    ...(task.error ? { error: task.error } : {}),
  };

  let text: string;
  if (task.status === "completed") {
    text = `Subagent completed (${targetOf(task)}).\n\n${task.result || "(no result)"}`;
  } else if (task.waitExpired && !isSubagentTerminalStatus(task.status)) {
    const waited = waitMs >= 1000 ? `${Math.round(waitMs / 1000)}s` : `${waitMs}ms`;
    text = `Subagent is still ${task.status} after ${waited} (${targetOf(task)}).`
      + " The task keeps running in the background; it was not cancelled and its runtime limit is unaffected.";
  } else if (isSubagentTerminalStatus(task.status)) {
    const partial = task.result ? `\n\nLast partial output:\n${task.result}` : "";
    text = `Subagent ${task.status} (${targetOf(task)}).\n\n${task.error ?? "Unknown error"}${partial}`;
  } else {
    // Stopping (a stop was requested but not yet confirmed) is not terminal and
    // not a wait expiry: report the honest state.
    text = `Subagent is ${task.status} (${targetOf(task)}).`
      + " The stop was requested but has not been confirmed by the session yet.";
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
  action: "list" | "get",
  error: string,
): { content: Array<{ type: "text"; text: string }>; details: SubagentQueryErrorDetails; isError: true } {
  return {
    content: [{ type: "text" as const, text: error }],
    details: { action, error },
    isError: true,
  };
}

// ============================================================================
// Model-facing summaries
// ============================================================================

function iso(ms: number | null): string {
  return ms === null ? "—" : new Date(ms).toISOString();
}

function clock(ms: number | null): string {
  return ms === null ? "--:--:--" : iso(ms).slice(11, 19);
}

function taskSummaryLine(view: SubagentTaskView): string {
  const session = view.childSessionId ?? "(no child session yet)";
  const error = view.error ? ` — error: ${view.error}` : "";
  return `${session} — ${view.status} — ${view.subagentName} — "${view.description}"`
    + ` — task ${view.taskId} — created ${iso(view.createdAt)}${error}`;
}

function listText(list: SubagentSessionList): string {
  const lines: string[] = [];
  const filter = list.status ? ` — filter: status=${list.status}` : "";
  if (list.entries.length === 0) {
    lines.push(`No subagent sessions of this session${list.status ? ` with status=${list.status}` : ""} were found.`);
    if (list.offset > 0) {
      lines.push(`The page offset ${list.offset} is past the end; call action="list" with offset=0 to start over.`);
    }
  } else {
    const first = list.offset + 1;
    const last = list.offset + list.entries.length;
    lines.push(`Subagent sessions of this session — ${first}-${last} of ${list.total} (newest first)${filter}:`);
    list.entries.forEach((entry, index) => {
      lines.push(`  ${list.offset + index + 1}. ${taskSummaryLine(entry.latestTask)} — ${entry.taskCount} task(s)`);
    });
  }
  if (list.hasMore) {
    const nextOffset = list.offset + list.entries.length;
    lines.push(
      `${list.total - nextOffset} more session(s): call action="list" with offset=${nextOffset}`
      + `${list.status ? ` and status="${list.status}"` : ""} to read the next page.`,
    );
  } else if (list.entries.length > 0) {
    lines.push("That is the last page.");
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
    lines.push(
      `  [truncated] read the rest with action="get", task_id="${task.taskId}", result_offset=${window.nextOffset}.`,
    );
  } else if (window.skipped > 0 && window.text.length === 0) {
    // `result_offset` was at or past the end: nothing is returned, so point
    // back at a valid window instead of leaving the caller stuck.
    lines.push(`  result_offset ${window.skipped} is at/after the end of the ${window.total} chars; use result_offset=0 to read it again.`);
  }
  return lines;
}

function activityBlock(detail: SubagentTaskDetail): string[] {
  if (!detail.task.childSessionId) return [];
  if (detail.activityCount === 0) return ["  recent tool activity: none recorded."];
  if (detail.activities.length === 0) {
    // A zero window (`activity_limit: 0`) is a choice, not an empty session.
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
      // Continuing past the end of the message: point back at its start.
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

/**
 * Whole-block system-prompt contribution for `subagent`. Appended at the very
 * end of the system prompt via `appendSystemPromptOverride`, gated on the tool
 * being enabled AND part of the session's tool set. Built per session from the
 * configured profiles so the model always sees the current names and
 * descriptions; with no profiles configured it says so instead of listing
 * names that no longer exist.
 */
export function buildSubagentSystemPromptBlock(
  profiles: readonly SubagentProfile[] = listSubagentProfiles(),
): string {
  const catalog = profiles.length > 0
    ? profiles.map((profile) => `  - \`${profile.name}\`: ${profile.description}`).join("\n")
    : "  - (no subagents are configured yet; ask the user to create one in Settings → Subagents)";
  return `\
## Tool subagent guidelines
- For independent tasks that are parallelizable and have a well-defined scope, dispatch the tasks to subagents with \`subagent\` and \`action: "spawn"\`. Examples include codebase exploration, research and information gathering, and code review.
- \`subagent_name\` selects one of the configured subagents:
${catalog}
- Each subagent has its own system prompt, tool set, model and runtime limit; pick the one whose description best matches the task.
- \`spawn\` waits 15 minutes by default and returns the result. Pass a smaller \`wait_ms\` (0 for none) to keep working in parallel: the task keeps running in the background after the wait expires, and its status is not a failure.
- \`action: "list"\` finds this session's direct subagent sessions again (one row per child session with its newest task); filter with \`status\` and page with \`limit\`/\`offset\`. \`action: "get"\` reads one task by \`task_id\` or one child session by \`session_id\` (newest task detail plus task history), with a bounded \`result\` window, recent activity and an optional transcript page.
- When you need to explore the codebase, prioritize dispatching a read-only explorer subagent over exploring it yourself, and give it a purely exploration-and-reporting task without requiring suggestions.
- When you hand a subagent a change, files, or a question to review, also state the standards to judge against.
- Independent tasks can be dispatched together: emit several \`subagent\` calls in the same message instead of one per turn. Subagents run in parallel (at most ${MAX_CONCURRENT_SUBAGENT_RUNS} at a time, further tasks queue in order), so keep each task self-contained and do not make one depend on another's result.
`;
}

const TOOL_DESCRIPTION = [
  "Manage subagent tasks. action=\"spawn\" launches a persistent specialized subagent for a focused task and returns its result (waiting up to 15 minutes by default). Pick the subagent by name from the configured profiles listed in the subagent guidelines; the subagent runs in the current working directory and returns an evidence-based conclusion. With wait_ms=0 the call returns at once and the task keeps running in the background.",
  "action=\"list\" lists this session's direct subagent sessions (newest first, one row per child session with its newest task; filter with status, page with limit/offset).",
  "action=\"get\" reads one task by task_id or one child session by session_id (newest task detail plus paged task history); details carry status, timing, error, recent tool activity, a bounded result window and an optional transcript page. All lookups only see direct subagents of the calling session; truncation is always marked together with the offset that reads the rest.",
].join(" ");

export const subagentTool = defineTool<typeof SubagentParams, SubagentToolDetails>({
  name: SUBAGENT_TOOL_NAME,
  label: "Subagent",
  description: TOOL_DESCRIPTION,
  parameters: SubagentParams,
  // No `executionMode`: the SDK default ("parallel") is what lets one assistant
  // message dispatch several subagents at once. Declaring "sequential" would
  // demote the whole tool batch to serial and start them one after another.
  promptSnippet: "Launch a specialized subagent, list subagent sessions, or read one task.",
  // Guidelines moved to `buildSubagentSystemPromptBlock` — injected via
  // appendSystemPromptOverride, gated on the tool being loaded.
  async execute(_toolCallId, params, signal, onUpdate, ctx) {
    const parsed = parseSubagentParams(params);
    if (!parsed.ok) {
      const action = params.action;
      // Only list/get have the small error payload; a spawn argument error is
      // still reported through the spawn envelope the card understands.
      if (action === "list" || action === "get") return queryErrorEnvelope(action, parsed.error);
      return spawnErrorEnvelope({
        subagentName: params.subagent_name ?? "",
        description: params.description ?? "",
        error: parsed.error,
      });
    }

    // The parent comes from the call context, never from the tool's arguments,
    // so a child can only ever see its own direct subagents.
    const parentSessionId = ctx.sessionManager.getSessionId();
    const input = parsed.params;

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
      // Report the miss to the model (so it can retry with a listed name)
      // instead of throwing or writing a task row for a run that never starts.
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
        // Resolved before the child starts so a missing parent prompt fails the
        // spawn instead of silently choosing a different prompt.
        parentSystemPrompt: profile.inheritSystemPrompt ? parent.systemPrompt : null,
      });

      const manager = getSubagentTaskManager();
      const task = manager.spawn({
        parentSessionId: parent.parentSessionId,
        description,
        prompt,
        config,
        onProgress: (progress) => {
          // In-flight partials let the parent UI start rendering the child's
          // live panel (and its queued state) before the call returns. Content
          // stays empty: the block draws its own panel while the task is not
          // terminal, and any text would be mistaken for the final result.
          onUpdate?.({ content: [], details: spawnProgressDetails(progress) });
        },
      });

      const result = await manager.wait(task.taskId, {
        timeoutMs: waitMs,
        // The tool call's own abort (the user stopped the parent turn) is a
        // stop for this task; the turn module confirms it before the row turns
        // terminal, so the wait reports "stopping" rather than pretending.
        ...(signal ? { stopOnAbort: { signal, reason: SUBAGENT_CANCELLED } } : {}),
      });

      return waitResultEnvelope(result, waitMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return spawnErrorEnvelope({ subagentName: profile.name, description, error: message });
    }
  },
});
