import {
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  DEFAULT_SUBAGENT_WAIT_MS,
  SUBAGENT_RESULT_WINDOW_MAX,
  type SubagentProfile,
  type SubagentTaskConfigSnapshot,
} from "../shared/subagent";
import { resolveBackgroundPermissionMode } from "../shared/permission-mode";
import type { SubagentTaskOrigin } from "../shared/types";
import { MAX_CONCURRENT_SUBAGENT_RUNS } from "../shared/types";
import {
  runTurn,
  type AcquiredTurnSession,
  type TurnAbortSource,
  type TurnResult,
  type TurnSession,
  type TurnSessionFactory,
  type TurnSessionPolicy,
} from "./turn";
import { toSubagentEnd } from "./subagent-run-end";
import type { AgentSessionWrapper } from "./rpc-manager";
import { readSessionDetails, resolveSessionPath } from "./session-reader";
import { writeSessionName } from "./session-names";
import type { MessageOrigin } from "../shared/message-origin";
import { createLogger } from "./logger";
import { reconcileLeftoverSubagentTasksOnce } from "./subagent-startup";
import {
  LEGACY_SUBAGENT_SYSTEM_PROMPT,
  legacySubagentToolsOrThrow,
  parseSubagentConfigSnapshot,
  resolveSubagentChildConfig,
  restrictSubagentTools,
  subagentChildSessionStartOptions,
  tryResolveSubagentChildConfig,
} from "./subagent-restore";
import {
  completeSubagentTask,
  createSubagentTask,
  failSubagentTask,
  getSubagentSessionConfigSnapshot,
  getSubagentTask,
  getSubagentTaskByChildSessionId,
  getSubagentTaskByRequestId,
  isSubagentTerminalStatus,
  listSubagentTasks,
  listSubagentTasksForChildSession,
  markSubagentRunning,
  markSubagentStatus,
  setSubagentTaskConfigSnapshot,
  setSubagentTaskPartialOutput,
  type SubagentTask,
  type SubagentTaskStatus,
} from "./subagent-store";

const MAX_RESULT_LENGTH = SUBAGENT_RESULT_WINDOW_MAX;
const SUBAGENT_CUSTOM_ENTRY = "pi_work_subagent";

const log = createLogger("subagent/tasks");

export const SUBAGENT_CANCELLED = "Subagent cancelled";

export const SUBAGENT_SESSION_CLOSED_ERROR = "Subagent stopped because the subagent session was closed";

export const SUBAGENT_PARENT_STOPPED = "Subagent stopped because the parent session was stopped";

export const SUBAGENT_PARENT_DELETED = "Subagent stopped because the parent session was deleted";

export const SUBAGENT_SESSION_BUSY =
  "This subagent session is busy: it already has a queued, creating, running or stopping task."
  + " Wait for that task to finish (or cancel it) before continuing the session; inputs are never queued or steered into a running turn.";

export function resolveSubagentSystemPrompt(
  profile: Pick<SubagentProfile, "inheritSystemPrompt" | "systemPrompt">,
  parentSystemPrompt: string | null | undefined,
  cwd: string,
): { systemPromptOverride: string } | { systemPromptPrefix: string } {
  if (profile.inheritSystemPrompt) {
    const inherited = parentSystemPrompt?.trim() ?? "";
    if (!inherited) throw new Error("The parent session has no system prompt to inherit");
    return { systemPromptOverride: inherited };
  }
  return { systemPromptPrefix: `${profile.systemPrompt}\n\nYour current working directory is ${cwd}` };
}

export function resolveSubagentTaskConfig(input: {
  profile: SubagentProfile;
  cwd: string;
  parentModel: { provider: string; modelId: string };
  parentSystemPrompt: string | null | undefined;
}): SubagentTaskConfigSnapshot {
  const prompt = resolveSubagentSystemPrompt(input.profile, input.parentSystemPrompt, input.cwd);
  return {
    subagentName: input.profile.name,
    cwd: input.cwd,
    model: input.profile.model ?? input.parentModel,
    thinkingLevel: input.profile.thinkingLevel,
    permissionMode: resolveBackgroundPermissionMode(input.profile.permissionMode),
    tools: restrictSubagentTools(input.profile.tools),
    systemPrompt: "systemPromptOverride" in prompt
      ? { kind: "override", text: prompt.systemPromptOverride }
      : { kind: "prefix", text: prompt.systemPromptPrefix },
    timeoutMs: input.profile.timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS,
  };
}

export interface SubagentTaskProgress {
  taskId: string;
  childSessionId: string | null;
  status: SubagentTaskStatus;
  subagentName: string;
  description: string;
  origin: SubagentTaskOrigin;
}

export interface SubagentTaskWaitResult extends SubagentTaskProgress {
  waitExpired: boolean;
  result: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface SpawnSubagentTaskInput {
  parentSessionId: string;
  description: string;
  prompt: string;
  config: SubagentTaskConfigSnapshot;
  requestId?: string | null;
  onProgress?: (progress: SubagentTaskProgress) => void;
}

export interface ContinueSubagentTaskInput {
  parentSessionId: string;
  childSessionId: string;
  description: string;
  prompt: string;
  requestId?: string | null;
  origin?: SubagentTaskOrigin;
  messageOrigin?: MessageOrigin;
  onProgress?: (progress: SubagentTaskProgress) => void;
}

export interface WaitSubagentTaskOptions {
  timeoutMs?: number;
  stopOnAbort?: { signal: AbortSignal; reason: string };
  observeAbort?: AbortSignal;
}

export interface StopAllSubagentResult {
  stopped: number;
  stopping: boolean;
}

export interface SubagentTaskManager {
  spawn(input: SpawnSubagentTaskInput): SubagentTaskProgress;
  continue(input: ContinueSubagentTaskInput): SubagentTaskProgress;
  wait(parentSessionId: string, taskId: string, options?: WaitSubagentTaskOptions): Promise<SubagentTaskWaitResult>;
  stop(parentSessionId: string, taskId: string, reason?: string): void;
  stopAll(parentSessionId: string, reason?: string): StopAllSubagentResult;
  isStopping(parentSessionId: string): boolean;
  get(parentSessionId: string, taskId: string): SubagentTask | null;
  liveStatus(parentSessionId: string, taskId: string): SubagentTaskStatus | null;
  idle(): Promise<void>;
}

export interface SubagentChildSession extends TurnSession {
  inner: {
    sessionManager: {
      appendSessionInfo(name: string): unknown;
      appendCustomEntry(customType: string, data?: unknown): unknown;
    };
  };
}

export type SubagentChildSessionFactory = (input: {
  taskId: string;
  parentSessionId: string;
  description: string;
  cwd: string;
  config: SubagentTaskConfigSnapshot;
  session?: TurnSessionPolicy;
}) => Promise<AcquiredTurnSession & { session: SubagentChildSession }>;

export interface SubagentTaskTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SubagentTaskManagerDeps {
  runTurn: typeof runTurn;
  reconcileOnCreate?: boolean;
  maxConcurrent?: number;
  timers?: SubagentTaskTimers;
  createChildSession?: SubagentChildSessionFactory;
}

interface RunningTask {
  taskId: string;
  parentSessionId: string;
  childSessionId: string | null;
  reusedSessionId: string | null;
  status: SubagentTaskStatus;
  config: SubagentTaskConfigSnapshot | null;
  subagentName: string;
  description: string;
  prompt: string;
  origin: SubagentTaskOrigin;
  messageOrigin: MessageOrigin | null;
  started: boolean;
  finished: boolean;
  stop: AbortController;
  stopReason: string | null;
  progressListeners: Set<(progress: SubagentTaskProgress) => void>;
  done: Promise<void>;
  resolveDone: () => void;
}

const defaultTimers: SubagentTaskTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function truncateResult(text: string): string {
  if (text.length <= MAX_RESULT_LENGTH) return text;
  return `${text.slice(0, MAX_RESULT_LENGTH)}\n… [truncated ${text.length - MAX_RESULT_LENGTH} chars]`;
}

function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const value = message as { role?: unknown; content?: unknown };
  if (value.role !== "assistant") return "";
  if (!Array.isArray(value.content)) return "";
  return value.content
    .filter((block): block is { type?: unknown; text?: unknown } => !!block && typeof block === "object")
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n\n")
    .trim();
}

async function readLastAssistantText(realSessionId: string): Promise<string> {
  const details = await readSessionDetails(realSessionId);
  const messages = details?.context.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = extractMessageText(messages[i]);
    if (text) return truncateResult(text);
  }
  return "";
}

function taskKey(parentSessionId: string, taskId: string): string {
  return `${parentSessionId}\u0000${taskId}`;
}

function progressOfRow(task: SubagentTask): SubagentTaskProgress {
  return {
    taskId: task.taskId,
    childSessionId: task.childSessionId,
    status: task.status,
    subagentName: task.subagentName,
    description: task.description,
    origin: task.origin,
  };
}

function normalizeRequestId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT");
}

function asWaitResult(task: SubagentTask, waitExpired: boolean): SubagentTaskWaitResult {
  return {
    taskId: task.taskId,
    childSessionId: task.childSessionId,
    status: task.status,
    subagentName: task.subagentName,
    description: task.description,
    origin: task.origin,
    waitExpired,
    result: task.result,
    error: task.error,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
  };
}

export async function openSubagentChildSession(
  sessionId: string,
): Promise<AgentSessionWrapper | null> {
  const { getRpcSession, startRpcSession } = await import("./rpc-manager");
  const live = getRpcSession(sessionId);
  if (live?.isAlive()) return live;

  const ownerTask = getSubagentTaskByChildSessionId(sessionId);
  if (!ownerTask) return null;
  const sessionFile = await resolveSessionPath(sessionId);
  if (!sessionFile) return null;

  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const headerCwd = SessionManager.open(sessionFile).getHeader()?.cwd;
  const restored = await tryResolveSubagentChildConfig({
    parentSessionId: ownerTask.parentSessionId,
    childSessionId: sessionId,
    subagentName: ownerTask.subagentName,
  });
  if (!restored) {
    const { session } = await startRpcSession(
      sessionId,
      sessionFile,
      headerCwd ?? process.cwd(),
      [],
      "subagent",
      {
        systemPromptPrefix: LEGACY_SUBAGENT_SYSTEM_PROMPT,
        stripDefaultSystemPromptSections: true,
        persistToolSelection: false,
      },
    );
    return session;
  }
  const config = restored.config;
  const { session } = await startRpcSession(
    sessionId,
    sessionFile,
    headerCwd ?? config.cwd,
    restrictSubagentTools(config.tools),
    "subagent",
    subagentChildSessionStartOptions(config, ownerTask.parentSessionId),
  );
  return session;
}

const startSubagentChildSession: SubagentChildSessionFactory = async (input) => {
  const { getRpcSession, startRpcSession } = await import("./rpc-manager");
  const config = input.config;
  const tools = restrictSubagentTools(config.tools);
  const options = subagentChildSessionStartOptions(config, input.parentSessionId);

  if (input.session?.kind === "reuse") {
    const sessionId = input.session.sessionId;
    const live = getRpcSession(sessionId);
    if (live?.isAlive()) {
      return { session: live, sessionId, realSessionId: sessionId };
    }
    const sessionFile = await resolveSessionPath(sessionId);
    if (!sessionFile) throw new Error(`Session not found: ${sessionId}`);
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    const cwd = SessionManager.open(sessionFile).getHeader()?.cwd ?? config.cwd;
    const { session, realSessionId } = await startRpcSession(
      sessionId,
      sessionFile,
      cwd,
      tools,
      "subagent",
      options,
    );
    return { session, sessionId, realSessionId };
  }

  const { session, realSessionId } = await startRpcSession(
    `__subagent__${input.parentSessionId}:${input.taskId}`,
    "",
    input.cwd,
    tools,
    "subagent",
    options,
  );
  return { session, sessionId: realSessionId, realSessionId };
};

export function createSubagentTaskManager(deps: SubagentTaskManagerDeps): SubagentTaskManager {
  if (deps.reconcileOnCreate) reconcileLeftoverSubagentTasksOnce();

  const timers = deps.timers ?? defaultTimers;
  const maxConcurrent = deps.maxConcurrent ?? MAX_CONCURRENT_SUBAGENT_RUNS;
  const running = new Map<string, RunningTask>();
  const queue: string[] = [];
  let active = 0;
  const stoppingParents = new Set<string>();

  const progressOf = (task: RunningTask): SubagentTaskProgress => ({
    taskId: task.taskId,
    childSessionId: task.childSessionId,
    status: task.status,
    subagentName: task.subagentName,
    description: task.description,
    origin: task.origin,
  });

  const emit = (task: RunningTask) => {
    const progress = progressOf(task);
    for (const listener of [...task.progressListeners]) {
      try {
        listener(progress);
      } catch {
      }
    }
  };

  const setStatus = (task: RunningTask, status: SubagentTaskStatus) => {
    task.status = status;
    emit(task);
  };

  const dropFromQueue = (parentSessionId: string, taskId: string) => {
    const index = queue.indexOf(taskKey(parentSessionId, taskId));
    if (index !== -1) queue.splice(index, 1);
  };

  const finish = (task: RunningTask) => {
    if (task.finished) return;
    task.finished = true;
    if (task.started) active -= 1;
    running.delete(taskKey(task.parentSessionId, task.taskId));
    task.resolveDone();
    emit(task);
    releaseParentStopIfIdle(task.parentSessionId);
    pump();
  };

  const releaseParentStopIfIdle = (parentSessionId: string) => {
    if (!stoppingParents.has(parentSessionId)) return;
    for (const task of running.values()) {
      if (task.parentSessionId === parentSessionId && !task.finished) return;
    }
    stoppingParents.delete(parentSessionId);
  };

  const finishTerminal = (task: RunningTask, status: SubagentTaskStatus, error?: string) => {
    task.status = status;
    failSubagentTask(task.parentSessionId, task.taskId, error ?? SUBAGENT_CANCELLED, status as "cancelled" | "failed" | "interrupted");
    finish(task);
  };

  const finalize = async (task: RunningTask, result: TurnResult, config: SubagentTaskConfigSnapshot) => {
    const end = toSubagentEnd(result, config.timeoutMs);
    let text = result.status === "completed" ? result.text.trim() : "";
    if (!text && (end.status === "completed" || end.partialOutput)) {
      try {
        text = await readLastAssistantText(result.realSessionId);
      } catch {
        text = "";
      }
    }
    if (end.status === "completed") {
      completeSubagentTask(task.parentSessionId, task.taskId, text);
    } else {
      const reason = end.error ?? "Unknown error";
      failSubagentTask(task.parentSessionId, task.taskId, reason, end.status);
      if (text) setSubagentTaskPartialOutput(task.parentSessionId, task.taskId, text);
    }
    task.status = getSubagentTask(task.parentSessionId, task.taskId)?.status ?? end.status;
    finish(task);
  };

  const ensureTaskConfig = async (task: RunningTask): Promise<SubagentTaskConfigSnapshot> => {
    if (task.config) return task.config;
    if (!task.reusedSessionId) {
      throw new Error(
        "This subagent task has no configuration snapshot and no existing child session to recover one from.",
      );
    }
    const restored = await resolveSubagentChildConfig({
      parentSessionId: task.parentSessionId,
      childSessionId: task.reusedSessionId,
      subagentName: task.subagentName,
    });
    if (restored.source === "recovered") {
      log.warn("recovered a legacy subagent configuration", {
        taskId: task.taskId,
        childSessionId: task.reusedSessionId,
        notes: restored.notes,
      });
    }
    if (!setSubagentTaskConfigSnapshot(task.parentSessionId, task.taskId, JSON.stringify(restored.config))) {
      throw new Error("This subagent task is no longer active; the recovered configuration was not applied.");
    }
    task.config = restored.config;
    return restored.config;
  };

  const startTask = async (task: RunningTask) => {
    task.started = true;

    markSubagentStatus(task.parentSessionId, task.taskId, "creating");
    setStatus(task, "creating");
    let config = task.config;
    if (!config) {
      try {
        config = await ensureTaskConfig(task);
      } catch (error) {
        finishTerminal(task, "failed", error instanceof Error ? error.message : String(error));
        return;
      }
      if (task.stop.signal.aborted) {
        finishTerminal(task, "cancelled", task.stopReason ?? SUBAGENT_CANCELLED);
        return;
      }
    }

    const registryKey = `__subagent__${task.parentSessionId}:${task.taskId}`;
    const displayName = `[Subagent] ${task.description}`;
    const childRun: { session: SubagentChildSession | null; offDestroy: (() => void) | null } = {
      session: null,
      offDestroy: null,
    };
    const childGone = new AbortController();
    const createChild = deps.createChildSession ?? startSubagentChildSession;

    const abortSources: TurnAbortSource[] = [
      {
        signal: task.stop.signal,
        reason: task.stopReason ?? SUBAGENT_CANCELLED,
      },
      { signal: childGone.signal, reason: SUBAGENT_SESSION_CLOSED_ERROR },
    ];

    const factory: TurnSessionFactory = async (cwd, _toolNames, _source, policy) => {
      const acquired = await createChild({
        taskId: task.taskId,
        parentSessionId: task.parentSessionId,
        description: task.description,
        cwd,
        config,
        session: policy,
      });
      childRun.session = acquired.session;
      childRun.offDestroy = acquired.session.onDestroy(() => childGone.abort());
      task.childSessionId = acquired.realSessionId;
      markSubagentRunning(task.parentSessionId, task.taskId, acquired.realSessionId);
      setStatus(task, "running");
      if (!task.reusedSessionId) {
        acquired.session.inner.sessionManager.appendSessionInfo(displayName);
        writeSessionName(acquired.realSessionId, displayName);
      }
      return {
        session: acquired.session,
        sessionId: task.reusedSessionId ?? registryKey,
        realSessionId: acquired.realSessionId,
      };
    };

    try {
      const result = await deps.runTurn(
        {
          cwd: config.cwd,
          prompt: task.prompt,
          source: "subagent",
          ...(task.messageOrigin ? { origin: task.messageOrigin } : {}),
          ...(task.reusedSessionId
            ? {
              session: { kind: "reuse" as const, sessionId: task.reusedSessionId },
              model: config.model,
              thinkingLevel: config.thinkingLevel,
            }
            : {}),
          timeoutMs: config.timeoutMs,
          abortSources,
          confirmStop: true,
        },
        factory,
      );

      if (result.status === "completed" && childRun.session) {
        childRun.session.inner.sessionManager.appendCustomEntry(SUBAGENT_CUSTOM_ENTRY, {
          taskId: task.taskId,
          parentSessionId: task.parentSessionId,
          description: task.description,
          subagentName: config.subagentName,
        });
      }
      await finalize(task, result, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finishTerminal(task, "failed", message);
    } finally {
      childRun.offDestroy?.();
    }
  };

  const pump = () => {
    while (active < maxConcurrent && queue.length > 0) {
      const key = queue.shift()!;
      const task = running.get(key);
      if (!task || task.finished) continue;
      active += 1;
      void startTask(task).catch((error: unknown) => {
        finishTerminal(task, "failed", error instanceof Error ? error.message : String(error));
      });
    }
  };

  const createManagedTask = (input: {
    parentSessionId: string;
    description: string;
    prompt: string;
    config: SubagentTaskConfigSnapshot | null;
    subagentName: string;
    childSessionId: string | null;
    reusedSessionId: string | null;
    requestId?: string | null;
    origin?: SubagentTaskOrigin;
    messageOrigin?: MessageOrigin;
    onProgress?: (progress: SubagentTaskProgress) => void;
  }): SubagentTaskProgress => {
    const requestId = normalizeRequestId(input.requestId);
    if (requestId) {
      const existing = getSubagentTaskByRequestId(input.parentSessionId, requestId);
      if (existing) return progressOfRow(existing);
    }

    let taskId: string;
    try {
      taskId = createSubagentTask({
        parentSessionId: input.parentSessionId,
        childSessionId: input.childSessionId,
        subagentName: input.subagentName,
        description: input.description,
        prompt: input.prompt,
        origin: input.origin ?? "tool",
        requestId,
        configSnapshot: input.config ? JSON.stringify(input.config) : null,
      }).taskId;
    } catch (error) {
      if (requestId && isUniqueConstraintError(error)) {
        const existing = getSubagentTaskByRequestId(input.parentSessionId, requestId);
        if (existing) return progressOfRow(existing);
      }
      throw error;
    }

    let resolveDone: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const task: RunningTask = {
      taskId,
      parentSessionId: input.parentSessionId,
      childSessionId: input.childSessionId,
      reusedSessionId: input.reusedSessionId,
      status: "queued",
      config: input.config,
      subagentName: input.subagentName,
      description: input.description,
      prompt: input.prompt,
      origin: input.origin ?? "tool",
      messageOrigin: input.messageOrigin ?? null,
      started: false,
      finished: false,
      stop: new AbortController(),
      stopReason: null,
      progressListeners: new Set(input.onProgress ? [input.onProgress] : []),
      done,
      resolveDone,
    };
    running.set(taskKey(task.parentSessionId, task.taskId), task);
    queue.push(taskKey(task.parentSessionId, task.taskId));
    emit(task);
    pump();
    return progressOf(task);
  };

  const spawn = (input: SpawnSubagentTaskInput): SubagentTaskProgress => {
    const requestId = normalizeRequestId(input.requestId);
    if (requestId) {
      const existing = getSubagentTaskByRequestId(input.parentSessionId, requestId);
      if (existing) return progressOfRow(existing);
    }
    if (stoppingParents.has(input.parentSessionId)) {
      throw new Error(
        "The parent session is stopping all subagent tasks; wait for the stop to finish before spawning a new one.",
      );
    }
    return createManagedTask({
      parentSessionId: input.parentSessionId,
      description: input.description,
      prompt: input.prompt,
      config: input.config,
      subagentName: input.config.subagentName,
      childSessionId: null,
      reusedSessionId: null,
      requestId: input.requestId,
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });
  };

  const continueTask = (input: ContinueSubagentTaskInput): SubagentTaskProgress => {
    const requestId = normalizeRequestId(input.requestId);
    if (requestId) {
      const existing = getSubagentTaskByRequestId(input.parentSessionId, requestId);
      if (existing) {
        if (existing.childSessionId !== input.childSessionId) {
          throw new Error(
            `request_id "${requestId}" was already used for a different subagent session; use a new request_id for this continue.`,
          );
        }
        return progressOfRow(existing);
      }
    }

    if (stoppingParents.has(input.parentSessionId)) {
      throw new Error(
        "The parent session is stopping all subagent tasks; wait for the stop to finish before continuing a subagent session.",
      );
    }

    const rows = listSubagentTasksForChildSession(input.parentSessionId, input.childSessionId);
    if (rows.length === 0) {
      throw new Error(
        `No subagent session "${input.childSessionId}" in this parent session. Only direct child sessions can be continued.`,
      );
    }

    const busy = [...running.values()].find(
      (task) => task.parentSessionId === input.parentSessionId
        && task.childSessionId === input.childSessionId
        && !task.finished,
    );
    if (busy) throw new Error(SUBAGENT_SESSION_BUSY);

    const snapshotJson = getSubagentSessionConfigSnapshot(input.parentSessionId, input.childSessionId);
    const config = parseSubagentConfigSnapshot(snapshotJson);
    if (!config) {
      legacySubagentToolsOrThrow(input.childSessionId);
    }
    const latestRow = rows[0];
    return createManagedTask({
      parentSessionId: input.parentSessionId,
      description: input.description,
      prompt: input.prompt,
      config,
      subagentName: latestRow.subagentName,
      childSessionId: input.childSessionId,
      reusedSessionId: input.childSessionId,
      requestId,
      origin: input.origin ?? "tool",
      ...(input.messageOrigin ? { messageOrigin: input.messageOrigin } : {}),
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });
  };

  const wait = async (
    parentSessionId: string,
    taskId: string,
    options: WaitSubagentTaskOptions = {},
  ): Promise<SubagentTaskWaitResult> => {
    const row = getSubagentTask(parentSessionId, taskId);
    if (!row) throw new Error(`No subagent task ${taskId} in this session`);
    if (isSubagentTerminalStatus(row.status)) return asWaitResult(row, false);
    const task = running.get(taskKey(parentSessionId, taskId));
    if (!task || task.finished) {
      return asWaitResult({ ...row, status: "interrupted" }, false);
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_SUBAGENT_WAIT_MS;
    let timer: unknown = null;
    let abortListener: (() => void) | null = null;
    let observeListener: (() => void) | null = null;
    const outcomes: Array<Promise<"done" | "timeout" | "stopped" | "observed">> = [
      task.done.then(() => "done" as const),
    ];
    if (timeoutMs <= 0) {
      outcomes.push(Promise.resolve("timeout" as const));
    } else {
      outcomes.push(new Promise<"timeout">((resolve) => {
        timer = timers.setTimeout(() => resolve("timeout"), timeoutMs);
      }));
    }
    const stopSignal = options.stopOnAbort?.signal;
    if (stopSignal) {
      outcomes.push(new Promise<"stopped">((resolve) => {
        abortListener = () => resolve("stopped");
        stopSignal.addEventListener("abort", abortListener, { once: true });
        if (stopSignal.aborted) resolve("stopped");
      }));
    }
    const observeSignal = options.observeAbort;
    if (observeSignal) {
      outcomes.push(new Promise<"observed">((resolve) => {
        observeListener = () => resolve("observed");
        observeSignal.addEventListener("abort", observeListener, { once: true });
        if (observeSignal.aborted) resolve("observed");
      }));
    }

    const outcome = await Promise.race(outcomes);
    if (timer !== null) timers.clearTimeout(timer);
    if (stopSignal && abortListener) stopSignal.removeEventListener("abort", abortListener);
    if (observeSignal && observeListener) observeSignal.removeEventListener("abort", observeListener);

    if (outcome === "stopped") {
      stop(parentSessionId, taskId, options.stopOnAbort?.reason);
    }

    const current = getSubagentTask(parentSessionId, taskId) ?? row;
    return asWaitResult(current, outcome === "timeout");
  };

  const stop = (parentSessionId: string, taskId: string, reason = SUBAGENT_CANCELLED) => {
    const row = getSubagentTask(parentSessionId, taskId);
    if (!row || isSubagentTerminalStatus(row.status)) return;
    const task = running.get(taskKey(parentSessionId, taskId));
    if (!task || task.finished) {
      failSubagentTask(parentSessionId, taskId, reason, "cancelled");
      return;
    }
    task.stopReason = task.stopReason ?? reason;
    if (!task.started) {
      dropFromQueue(parentSessionId, taskId);
      finishTerminal(task, "cancelled", task.stopReason);
      return;
    }
    if (!task.stop.signal.aborted) {
      markSubagentStatus(parentSessionId, taskId, "stopping");
      setStatus(task, "stopping");
      task.stop.abort();
    }
  };

  const stopAll = (parentSessionId: string, reason = SUBAGENT_PARENT_STOPPED): StopAllSubagentResult => {
    stoppingParents.add(parentSessionId);
    let stopped = 0;
    try {
      for (const row of listSubagentTasks(parentSessionId)) {
        if (isSubagentTerminalStatus(row.status)) continue;
        stop(parentSessionId, row.taskId, reason);
        stopped += 1;
      }
    } finally {
      releaseParentStopIfIdle(parentSessionId);
    }
    return { stopped, stopping: stoppingParents.has(parentSessionId) };
  };

  const idle = async () => {
    while (running.size > 0) {
      await Promise.all([...running.values()].map((task) => task.done));
    }
  };

  return {
    spawn,
    continue: continueTask,
    wait,
    stop,
    stopAll,
    isStopping: (parentSessionId) => stoppingParents.has(parentSessionId),
    get: (parentSessionId, taskId) => getSubagentTask(parentSessionId, taskId),
    liveStatus: (parentSessionId, taskId) => running.get(taskKey(parentSessionId, taskId))?.status ?? null,
    idle,
  };
}

declare global {
  var __piSubagentTaskManager: SubagentTaskManager | undefined;
}

export function getSubagentTaskManager(): SubagentTaskManager {
  if (!globalThis.__piSubagentTaskManager) {
    globalThis.__piSubagentTaskManager = createSubagentTaskManager({
      runTurn,
      reconcileOnCreate: true,
    });
  }
  return globalThis.__piSubagentTaskManager;
}

export function getExistingSubagentTaskManager(): SubagentTaskManager | null {
  return globalThis.__piSubagentTaskManager ?? null;
}

export function stopAllSubagentTasksForParent(
  parentSessionId: string,
  reason = SUBAGENT_PARENT_STOPPED,
): StopAllSubagentResult {
  const manager = getExistingSubagentTaskManager();
  if (!manager) return { stopped: 0, stopping: false };
  return manager.stopAll(parentSessionId, reason);
}

export function setSubagentTaskManagerForTests(manager: SubagentTaskManager | null): void {
  globalThis.__piSubagentTaskManager = manager ?? undefined;
}
