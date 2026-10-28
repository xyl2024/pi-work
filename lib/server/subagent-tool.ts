/**
 * The `subagent` agent tool.
 *
 * One tool, action-discriminated parameters. This issue ships `spawn`, `list`,
 * `get`, `wait`, `continue` and `cancel`:
 *
 * - `spawn` resolves a profile, freezes the child configuration, hands the task
 *   to the task manager and then *waits* (15 minutes by default, 0 for an
 *   immediate return) for an answer. The wait is only an observation — when it
 *   expires the task keeps running under the manager, its result stays
 *   collectable, and the parent turn can finish normally.
 * - `wait` observes an *existing* task by `task_id` with the same bounded
 *   semantics: it never starts, replays or cancels a turn. A task that is
 *   already terminal returns its result/error (and any partial output) at once;
 *   a task that is still running keeps running when the wait expires, and the
 *   caller can wait again or read it with `get`.
 * - `list` finds the calling session's direct subagent sessions again, one row
 *   per child session with its newest task, filterable by status and pageable.
 * - `get` reads one task by `task_id`, or one child session by `session_id`
 *   (newest task detail plus a paged task history). Results and transcripts are
 *   returned as explicit bounded windows that say how to read the rest.
 * - `cancel` asks one task (by `task_id`) to stop. A queued task is cancelled
 *   before it starts; a running task becomes `stopping` and only reaches
 *   `cancelled` once the child session confirms the stop. A terminal task is
 *   never overwritten by a late cancel.
 * - `continue` starts another turn in an existing child session by
 *   `session_id`. It creates a *new* task id, leaves every earlier task's
 *   input, result, error and timing untouched, and reuses the configuration
 *   frozen when that child session was created. A busy child (any unfinished
 *   task) is refused; inputs are never appended to or steered into a running
 *   turn.
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

/** The parsed shape is exactly the schema's: one type, no hand-mirrored twin. */
type SubagentRawParams = Static<typeof SubagentParams>;

/** Which parameters each action accepts; anything else is rejected by name. */
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

/** One rule for the optional dedupe key: trimmed, empty means absent. */
function normalizeRequestId(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Per-action validation. The schema already bounds each field that is present;
 * this adds the cross-field rules the schema cannot express (required arguments,
 * exactly one lookup id, arguments that belong to another action).
 */
export function parseSubagentParams(raw: SubagentRawParams): Parsed {
  const action = raw.action;
  // The SDK validates the schema before `execute`, but the retired
  // `spawn_subagent` name (and any other unknown action) must fail as a normal
  // argument error rather than crashing on a missing allowlist entry.
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
    // The description is only a card label; derive one from the input when the
    // caller did not name the turn.
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
export interface SubagentObservedDetails {
  taskId: string;
  childSessionId: string | null;
  /** Non-terminal while the caller only observed a part of the task's life. */
  status: SubagentTaskStatus;
  subagentName: string;
  description: string;
  /** True when the caller's wait ran out and the task is still unfinished. */
  waitExpired: boolean;
  /**
   * A bounded window of the completed result, or of the last partial output of
   * an abnormal stop. `resultTruncated` says the stored text is longer than
   * this window, and `resultNextOffset` is where `get` continues it.
   */
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

/** What a cancel reports: the state after the request, not a promise it stopped. */
export interface SubagentCancelDetails {
  action: "cancel";
  taskId: string;
  childSessionId: string | null;
  /** Status right after the request (`stopping` until the turn confirms). */
  status: SubagentTaskStatus;
  /** False when the task was already terminal and the late cancel was ignored. */
  requested: boolean;
  /**
   * True while the task is still unfinished: the card keeps the live panel
   * (the same "the task outlives this tool result" signal `wait` uses).
   */
  waitExpired?: boolean;
  /** The task's final result when it had already completed before the cancel. */
  result?: string;
  resultTruncated?: boolean;
  resultNextOffset?: number;
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

/**
 * A result-bearing action (spawn/wait/continue) returns the same bounded window
 * `get` uses, so a long report cannot arrive unmarked: the caller must be able
 * to tell a partial answer from the whole one and know the offset that reads
 * the rest. Spawn/wait/continue have no window arguments, so this is the
 * default window; deeper reads go through `get`.
 */
function boundedResult(text: string | null): SubagentTextWindow | null {
  return text ? sliceSubagentText(text, 0, SUBAGENT_RESULT_WINDOW_DEFAULT) : null;
}

/** The bounded result fields every result-bearing envelope reports the same way. */
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

/** The one "read the rest" sentence, shared by every truncation marker. */
function resultContinuation(taskId: string, window: SubagentTextWindow): string {
  return `read the rest with action="get", task_id="${taskId}", result_offset=${window.nextOffset}.`;
}

function truncationNote(taskId: string, window: SubagentTextWindow): string {
  const end = window.offset + window.text.length;
  return `[truncated] The stored result is ${window.total} chars; chars ${window.offset}-${end} are shown`
    + ` and ${window.remaining} follow. To continue, ${resultContinuation(taskId, window)}`;
}

/**
 * The model-facing text. Deliberately explicit about which of the two limits
 * expired (wait vs. runtime) and about the task still being alive, so the
 * parent never mistakes a wait timeout for a failed task.
 */
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
    // A stop was requested but not yet confirmed: report the honest state and
    // how to observe the confirmation.
    text = `Subagent is stopping (${targetOf(task)}).`
      + " The stop was requested but has not been confirmed by the session yet."
      + ` Observe it again with action="wait", task_id="${task.taskId}".`;
  } else {
    // Non-terminal and not a timeout: the caller's wait was cancelled (its turn
    // stopped). Waiting is only observation, so the task is still alive.
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

/**
 * The model-facing cancel text. It never claims the execution already stopped:
 * a running task is `stopping` until the turn module confirms the abort, and a
 * terminal task is reported as untouched so a late cancel cannot look like it
 * rewrote a finished result.
 */
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
    // A row that is still non-terminal without being `stopping` is not a
    // state the manager produces after a stop; report it honestly.
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
  // A manual task is the user typing into the child session themselves; the
  // parent must be able to tell those apart from its own delegations.
  const origin = view.origin === "manual" ? " — manual input by the user" : "";
  return `${session} — ${view.status} — ${view.subagentName} — "${view.description}"${origin}`
    + ` — task ${view.taskId} — created ${iso(view.createdAt)}${error}`;
}

/**
 * One list row as a labelled block: the session id, the status/subagent of its
 * latest task, that task's id and the session's task count are easy to confuse
 * when they sit on one packed line, so every field gets its own line here.
 */
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
  // A manual task is the user typing into the child session themselves; the
  // parent must be able to tell those apart from its own delegations.
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

/**
 * Whole-block system-prompt contribution for `subagent`. Appended at the very
 * end of the system prompt via `appendSystemPromptOverride`, gated on the tool
 * being enabled AND part of the session's tool set. Built per session from the
 * configured profiles so the model always sees the current names and
 * descriptions; with no profiles configured it says so instead of listing
 * names that no longer exist.
 *
 * Deliberately small, and capped by a test: everything the tool description,
 * the parameter schema or a tool result already states is NOT repeated here.
 * What is left is only what none of those can carry — when to delegate, the
 * profile catalog (dynamic configuration), two behavioral preferences, and the
 * one fact a parent is likely to misread (an expired wait is not a failure).
 */
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

/**
 * Deliberately minimal, and capped by a test: the per-action semantics live in
 * the `action` enum description, the per-action arguments and defaults in the
 * parameter descriptions, and the runtime state transitions in the tool
 * results. This line only has to make the tool discoverable at all.
 */
const TOOL_DESCRIPTION =
  "Manage subagent tasks: spawn, wait, continue, list, get or cancel one persistent child session.";

export const subagentTool = defineTool<typeof SubagentParams, SubagentToolDetails>({
  name: SUBAGENT_TOOL_NAME,
  label: "Subagent",
  description: TOOL_DESCRIPTION,
  parameters: SubagentParams,
  // No `executionMode`: the SDK default ("parallel") is what lets one assistant
  // message dispatch several subagents at once. Declaring "sequential" would
  // demote the whole tool batch to serial and start them one after another.
  promptSnippet: "Delegate a focused task to a specialized subagent, then observe, continue or cancel it.",
  // Guidelines moved to `buildSubagentSystemPromptBlock` — injected via
  // appendSystemPromptOverride, gated on the tool being loaded.
  async execute(_toolCallId, params, signal, onUpdate, ctx) {
    const parsed = parseSubagentParams(params);
    if (!parsed.ok) {
      const action = params.action;
      // list/get/wait share the small error payload; a spawn argument error is
      // still reported through the spawn envelope the card understands.
      if (action === "list" || action === "get" || action === "wait" || action === "continue" || action === "cancel") {
        return queryErrorEnvelope(action, parsed.error);
      }
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

    if (input.action === "spawn" && input.requestId) {
      // Dedupe before profile resolution and the stop gate: a retry of an
      // already-created request must return that task even if the profile was
      // edited away or the parent has since entered a stop window. The manager
      // also dedupes, but only this early check can spare the profile lookup.
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
        // Ownership first: a session of another parent is indistinguishable
        // from one that never existed, so continue cannot read or steer it.
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
          // Same contract as spawn: stopping the parent turn while it waits is
          // a stop request for this task, confirmed by the turn module.
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
        // Ownership is checked before the manager is asked anything, so a task
        // of another parent is indistinguishable from a task that never
        // existed. The wait observes only: `observeAbort` ends the wait when
        // the caller's turn stops, but never stops the task or frees its slot.
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
        // Ownership first: another parent's task is indistinguishable from one
        // that never existed, so cancel cannot probe or touch foreign tasks.
        const before = getSubagentTaskForParent(parentSessionId, input.taskId);
        const manager = getSubagentTaskManager();
        const wasTerminal = isSubagentTerminalStatus(before.status);
        // A terminal task is final: never write it, so a late cancel cannot
        // overwrite a landed result (or a prior stop).
        if (!wasTerminal) {
          manager.stop(parentSessionId, input.taskId, SUBAGENT_CANCELLED);
        }
        const after = manager.get(parentSessionId, input.taskId) ?? before;
        // Report what actually happened, not what was attempted: a live stop
        // is `stopping` (or `cancelled` for a queued task); anything else was
        // already final (or a stale row reconciled on manager start) and left
        // untouched.
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
        ...(input.requestId ? { requestId: input.requestId } : {}),
        onProgress: (progress) => {
          // In-flight partials let the parent UI start rendering the child's
          // live panel (and its queued state) before the call returns. Content
          // stays empty: the block draws its own panel while the task is not
          // terminal, and any text would be mistaken for the final result.
          onUpdate?.({ content: [], details: spawnProgressDetails(progress) });
        },
      });

      const result = await manager.wait(parentSessionId, task.taskId, {
        timeoutMs: waitMs,
        // The tool call's own abort (the user stopped the parent turn) is a
        // stop for this task; the turn module confirms it before the row turns
        // terminal, so the wait reports "stopping" rather than pretending.
        ...(signal ? { stopOnAbort: { signal, reason: SUBAGENT_CANCELLED } } : {}),
      });

      return waitResultEnvelope("spawn", result, waitMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return spawnErrorEnvelope({ subagentName: profile.name, description, error: message });
    }
  },
});
