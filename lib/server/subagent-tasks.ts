/**
 * Subagent task lifecycle: one task per delegation, owned here rather than by
 * the tool call that created it.
 *
 * The distinction this module exists for (ADR-0022): a subagent *session* keeps
 * the reusable context, while every delegation is a *task* with its own id,
 * status, result and timing. A tool call can only ever wait for a task — the
 * task itself is scheduled, executed, persisted and finished here. A wait that
 * expires therefore observes nothing more; it does not cancel the turn, release
 * its concurrency slot or unregister it from this module.
 *
 * Scheduling: at most `MAX_CONCURRENT_SUBAGENT_RUNS` tasks execute at once, the
 * rest queue FIFO. Queue time counts against the caller's wait but never
 * against the child's runtime limit, which starts with the turn (see
 * `runTurn`'s deadline). The turn itself goes through the one turn seam
 * (`lib/server/turn`), so `agent_settled` remains the only completion signal and
 * a requested stop is only reported once the session confirmed it
 * (`confirmStop`).
 */
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  DEFAULT_SUBAGENT_WAIT_MS,
  SUBAGENT_TOOL_NAME,
  type SubagentProfile,
  type SubagentTaskConfigSnapshot,
} from "../shared/subagent";
import { MAX_CONCURRENT_SUBAGENT_RUNS } from "../shared/types";
import {
  runTurn,
  type AcquiredTurnSession,
  type TurnAbortSource,
  type TurnResult,
  type TurnSession,
  type TurnSessionFactory,
} from "./turn";
import { toSubagentEnd } from "./subagent-run-end";
import { readSessionDetails } from "./session-reader";
import { writeSessionName } from "./session-names";
import {
  completeSubagentTask,
  createSubagentTask,
  failSubagentTask,
  getSubagentTask,
  isSubagentTerminalStatus,
  markSubagentRunning,
  markSubagentStatus,
  reconcileInterruptedSubagentTasks,
  setSubagentTaskPartialOutput,
  type SubagentTask,
  type SubagentTaskStatus,
} from "./subagent-store";

const MAX_RESULT_LENGTH = 20_000;
const SUBAGENT_CUSTOM_ENTRY = "pi_work_subagent";

/**
 * The cancel wording shared with the tool call's abort source. Kept next to the
 * task manager because the manager owns the stop now, not the tool.
 */
export const SUBAGENT_CANCELLED = "Subagent cancelled";

/** Session-closed wording (kept verbatim from the pre-lifecycle tool). */
export const SUBAGENT_SESSION_CLOSED_ERROR = "Subagent stopped because the subagent session was closed";

/**
 * How a child session's system prompt is built. An inheriting profile gets the
 * parent's rendered prompt verbatim; any other profile gets its own prompt with
 * the child's working directory appended. Inherit with no parent prompt is an
 * explicit failure — silently falling back would run the child under a prompt
 * the user did not choose.
 */
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

/**
 * Freeze the configuration a new child session runs with. The parent's model is
 * only the fallback: a profile that names a model keeps it.
 */
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
    // A child never gets the subagent tool, whatever the profile lists: the
    // rename must not turn a stale tool name into recursive delegation.
    tools: input.profile.tools.filter((tool) => tool !== SUBAGENT_TOOL_NAME),
    systemPrompt: "systemPromptOverride" in prompt
      ? { kind: "override", text: prompt.systemPromptOverride }
      : { kind: "prefix", text: prompt.systemPromptPrefix },
    timeoutMs: input.profile.timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS,
  };
}

/** One lifecycle snapshot a waiting caller (or the UI) can render. */
export interface SubagentTaskProgress {
  taskId: string;
  childSessionId: string | null;
  status: SubagentTaskStatus;
  subagentName: string;
  description: string;
}

/** What a wait observes: the task's current state plus whether the wait timed out. */
export interface SubagentTaskWaitResult extends SubagentTaskProgress {
  /** True when the caller's wait expired; the task itself is unaffected. */
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
  /** Called on every status change while the task is unfinished. */
  onProgress?: (progress: SubagentTaskProgress) => void;
}

export interface WaitSubagentTaskOptions {
  /** How long to observe; 0 returns immediately. */
  timeoutMs?: number;
  /**
   * Stop the task if this fires while the caller is still waiting. A caller
   * that already returned owns no stop. Session-level entry points (the user's
   * stop-all, session deletion) call `stop()` directly; they are being wired in
   * the cancel/stop-all issue, so today this is the only stop the tool path
   * contributes.
   */
  stopOnAbort?: { signal: AbortSignal; reason: string };
}

export interface SubagentTaskManager {
  /** Create a task and schedule it. Returns immediately; use `wait` to observe. */
  spawn(input: SpawnSubagentTaskInput): SubagentTaskProgress;
  /** Observe a task up to `timeoutMs`; never cancels or unmanages it. */
  wait(taskId: string, options?: WaitSubagentTaskOptions): Promise<SubagentTaskWaitResult>;
  /**
   * Ask a task to stop. Terminal tasks are left alone (a late cancel must not
   * overwrite a finished result); a queued task is cancelled without starting.
   */
  stop(taskId: string, reason?: string): void;
  /** The persisted row, or null. */
  get(taskId: string): SubagentTask | null;
  /** Resolves once every unfinished task has finished | test / shutdown aid. */
  idle(): Promise<void>;
}

/**
 * A live child session, including the two session-manager entry points the task
 * manager writes through. `AgentSessionWrapper` satisfies this structurally;
 * tests substitute a fake.
 */
export interface SubagentChildSession extends TurnSession {
  inner: {
    sessionManager: {
      appendSessionInfo(name: string): unknown;
      appendCustomEntry(customType: string, data?: unknown): unknown;
    };
  };
}

/** How the manager acquires a child session (production: `startRpcSession`). */
export type SubagentChildSessionFactory = (input: {
  taskId: string;
  parentSessionId: string;
  description: string;
  cwd: string;
  config: SubagentTaskConfigSnapshot;
}) => Promise<AcquiredTurnSession & { session: SubagentChildSession }>;

/** Timer seam: tests drive the wait deadline without waiting 15 minutes. */
export interface SubagentTaskTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SubagentTaskManagerDeps {
  /** The turn seam; tests substitute a scripted adapter. */
  runTurn: typeof runTurn;
  /** Mark stale non-terminal rows interrupted when the manager is created. */
  reconcileOnCreate?: boolean;
  maxConcurrent?: number;
  timers?: SubagentTaskTimers;
  /** Child-session acquisition seam; tests substitute a fake session. */
  createChildSession?: SubagentChildSessionFactory;
}

interface RunningTask {
  taskId: string;
  parentSessionId: string;
  childSessionId: string | null;
  status: SubagentTaskStatus;
  config: SubagentTaskConfigSnapshot;
  description: string;
  prompt: string;
  /** Queued tasks have no turn yet, so a stop can settle them directly. */
  started: boolean;
  finished: boolean;
  /** Aborts the child turn; the turn module confirms the stop before reporting. */
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

function asWaitResult(task: SubagentTask, waitExpired: boolean): SubagentTaskWaitResult {
  return {
    taskId: task.taskId,
    childSessionId: task.childSessionId,
    status: task.status,
    subagentName: task.subagentName,
    description: task.description,
    waitExpired,
    result: task.result,
    error: task.error,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
  };
}

/**
 * Production child-session acquisition: a fresh session per task, under its own
 * registry key, with the frozen profile config and the *narrowed* tool set.
 * Lives here (not in the tool) because later turns of the same child session
 * reuse the same snapshot through this one path.
 */
const startSubagentChildSession: SubagentChildSessionFactory = async (input) => {
  // Dynamic import: this module is imported by the tool, which rpc-manager
  // loads; a static edge would close the cycle.
  const { startRpcSession } = await import("./rpc-manager");
  const config = input.config;
  const { session, realSessionId } = await startRpcSession(
    `__subagent__${input.taskId}`,
    "",
    input.cwd,
    config.tools,
    "subagent",
    {
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      allowedToolNames: config.tools,
      ...(config.systemPrompt.kind === "override"
        ? { systemPromptOverride: config.systemPrompt.text }
        : { systemPromptPrefix: config.systemPrompt.text }),
      stripDefaultSystemPromptSections: true,
      parentSessionId: input.parentSessionId,
    },
  );
  return { session, sessionId: realSessionId, realSessionId };
};

export function createSubagentTaskManager(deps: SubagentTaskManagerDeps): SubagentTaskManager {
  if (deps.reconcileOnCreate) reconcileInterruptedSubagentTasks();

  const timers = deps.timers ?? defaultTimers;
  const maxConcurrent = deps.maxConcurrent ?? MAX_CONCURRENT_SUBAGENT_RUNS;
  const running = new Map<string, RunningTask>();
  /** FIFO of task ids waiting for a slot. */
  const queue: string[] = [];
  let active = 0;

  const progressOf = (task: RunningTask): SubagentTaskProgress => ({
    taskId: task.taskId,
    childSessionId: task.childSessionId,
    status: task.status,
    subagentName: task.config.subagentName,
    description: task.description,
  });

  const emit = (task: RunningTask) => {
    const progress = progressOf(task);
    for (const listener of [...task.progressListeners]) {
      try {
        listener(progress);
      } catch {
        // A listener is a UI detail; it must not break task management.
      }
    }
  };

  const setStatus = (task: RunningTask, status: SubagentTaskStatus) => {
    task.status = status;
    emit(task);
  };

  const dropFromQueue = (taskId: string) => {
    const index = queue.indexOf(taskId);
    if (index !== -1) queue.splice(index, 1);
  };

  /** Release resources of a finished task; idempotent. */
  const finish = (task: RunningTask) => {
    if (task.finished) return;
    task.finished = true;
    if (task.started) active -= 1;
    running.delete(task.taskId);
    task.resolveDone();
    emit(task);
    pump();
  };

  const finishTerminal = (task: RunningTask, status: SubagentTaskStatus, error?: string) => {
    task.status = status;
    failSubagentTask(task.taskId, error ?? SUBAGENT_CANCELLED, status as "cancelled" | "failed" | "interrupted");
    finish(task);
  };

  /**
   * Map the turn's neutral result onto the task's own vocabulary, persist it
   * and close the task. The child's final text is read back from its session
   * file, exactly as the pre-lifecycle tool did: a completed task reports the
   * last assistant message with text; an abnormal stop keeps it as partial
   * output (stored beside the bare reason).
   */
  const finalize = async (task: RunningTask, result: TurnResult) => {
    const end = toSubagentEnd(result, task.config.timeoutMs);
    // A completed turn's reply text comes straight from the turn result (it is
    // the final assistant text the turn module classified). An abnormal stop
    // has no reply text by contract, so its partial output is re-read from the
    // child session file — exactly like the pre-lifecycle tool did.
    let text = result.status === "completed" ? result.text.trim() : "";
    if (!text && (end.status === "completed" || end.partialOutput)) {
      try {
        text = await readLastAssistantText(result.realSessionId);
      } catch {
        text = "";
      }
    }
    if (end.status === "completed") {
      completeSubagentTask(task.taskId, text);
    } else {
      const reason = end.error ?? "Unknown error";
      failSubagentTask(task.taskId, reason, end.status);
      if (text) setSubagentTaskPartialOutput(task.taskId, text);
    }
    // The persisted row is the truth: a guarded UPDATE can refuse to overwrite
    // an already-terminal task (a late event, a concurrent stop), and the live
    // status must follow the row rather than claim a write that did not happen.
    task.status = getSubagentTask(task.taskId)?.status ?? end.status;
    finish(task);
  };

  const startTask = async (task: RunningTask) => {
    task.started = true;

    const registryKey = `__subagent__${task.taskId}`;
    const displayName = `[Subagent] ${task.description}`;
    const config = task.config;
    // Typed through a holder: the only assignment happens inside the factory
    // closure, where a plain `let` would be narrowed to `never` afterwards.
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

    const factory: TurnSessionFactory = async (cwd) => {
      const acquired = await createChild({
        taskId: task.taskId,
        parentSessionId: task.parentSessionId,
        description: task.description,
        cwd,
        config,
      });
      childRun.session = acquired.session;
      // A child wrapper destroyed from outside (deleted from the UI, idle
      // reap) ends the run as interrupted; it is not a user stop.
      childRun.offDestroy = acquired.session.onDestroy(() => childGone.abort());
      // Publish the id before the prompt so a waiting caller can follow the
      // child's activity from the moment it exists.
      task.childSessionId = acquired.realSessionId;
      markSubagentRunning(task.taskId, acquired.realSessionId);
      setStatus(task, "running");
      acquired.session.inner.sessionManager.appendSessionInfo(displayName);
      writeSessionName(acquired.realSessionId, displayName);
      return { session: acquired.session, sessionId: registryKey, realSessionId: acquired.realSessionId };
    };

    try {
      markSubagentStatus(task.taskId, "creating");
      setStatus(task, "creating");
      const result = await deps.runTurn(
        {
          cwd: config.cwd,
          prompt: task.prompt,
          source: "subagent",
          // The runtime limit starts here, with the turn — never with the queue.
          timeoutMs: config.timeoutMs,
          abortSources,
          // A stop is only reported once the session confirmed it, so the row
          // never claims a terminal state while the turn is still running.
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
      await finalize(task, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finishTerminal(task, "failed", message);
    } finally {
      childRun.offDestroy?.();
    }
  };

  const pump = () => {
    while (active < maxConcurrent && queue.length > 0) {
      const taskId = queue.shift()!;
      const task = running.get(taskId);
      if (!task || task.finished) continue;
      active += 1;
      // Last-resort guard: a failure outside startTask's own try/catch (for
      // example a DB write that refuses) must not leak the slot or leave the
      // row non-terminal forever.
      void startTask(task).catch((error: unknown) => {
        finishTerminal(task, "failed", error instanceof Error ? error.message : String(error));
      });
    }
  };

  const spawn = (input: SpawnSubagentTaskInput): SubagentTaskProgress => {
    const taskId = `subagent:${randomUUID()}`;
    createSubagentTask({
      taskId,
      parentSessionId: input.parentSessionId,
      subagentName: input.config.subagentName,
      description: input.description,
      prompt: input.prompt,
      configSnapshot: JSON.stringify(input.config),
    });

    let resolveDone: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const task: RunningTask = {
      taskId,
      parentSessionId: input.parentSessionId,
      childSessionId: null,
      status: "queued",
      config: input.config,
      description: input.description,
      prompt: input.prompt,
      started: false,
      finished: false,
      stop: new AbortController(),
      stopReason: null,
      progressListeners: new Set(input.onProgress ? [input.onProgress] : []),
      done,
      resolveDone,
    };
    running.set(taskId, task);
    queue.push(taskId);
    emit(task);
    pump();
    return progressOf(task);
  };

  const wait = async (taskId: string, options: WaitSubagentTaskOptions = {}): Promise<SubagentTaskWaitResult> => {
    const row = getSubagentTask(taskId);
    if (!row) throw new Error(`No subagent task with id "${taskId}"`);
    const task = running.get(taskId);
    if (!task || task.finished || isSubagentTerminalStatus(row.status)) {
      return asWaitResult(row, false);
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_SUBAGENT_WAIT_MS;
    let timer: unknown = null;
    let abortListener: (() => void) | null = null;
    const outcomes: Array<Promise<"done" | "timeout" | "stopped">> = [
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

    const outcome = await Promise.race(outcomes);
    if (timer !== null) timers.clearTimeout(timer);
    if (stopSignal && abortListener) stopSignal.removeEventListener("abort", abortListener);

    if (outcome === "stopped") {
      // The caller is going away; that is a stop request for this task, not a
      // reason to forget it. The stop is confirmed by the turn module.
      stop(taskId, options.stopOnAbort?.reason);
    }

    const current = getSubagentTask(taskId) ?? row;
    return asWaitResult(current, outcome === "timeout");
  };

  const stop = (taskId: string, reason = SUBAGENT_CANCELLED) => {
    const row = getSubagentTask(taskId);
    if (!row || isSubagentTerminalStatus(row.status)) return;
    const task = running.get(taskId);
    if (!task || task.finished) {
      // No live management (a row left over from an earlier process): settle it
      // honestly instead of pretending a turn is still being stopped.
      failSubagentTask(taskId, reason, "cancelled");
      return;
    }
    task.stopReason = task.stopReason ?? reason;
    if (!task.started) {
      // Queued: nothing runs, so there is nothing to confirm.
      dropFromQueue(taskId);
      finishTerminal(task, "cancelled", task.stopReason);
      return;
    }
    if (!task.stop.signal.aborted) {
      markSubagentStatus(taskId, "stopping");
      setStatus(task, "stopping");
      task.stop.abort();
    }
  };

  const idle = async () => {
    while (running.size > 0) {
      await Promise.all([...running.values()].map((task) => task.done));
    }
  };

  return { spawn, wait, stop, get: (taskId) => getSubagentTask(taskId), idle };
}

declare global {
  var __piSubagentTaskManager: SubagentTaskManager | undefined;
}

/** The process-wide task manager (one queue, one slot table). */
export function getSubagentTaskManager(): SubagentTaskManager {
  if (!globalThis.__piSubagentTaskManager) {
    globalThis.__piSubagentTaskManager = createSubagentTaskManager({
      runTurn,
      reconcileOnCreate: true,
    });
  }
  return globalThis.__piSubagentTaskManager;
}

/** Test seam: replace / clear the process-wide manager. */
export function setSubagentTaskManagerForTests(manager: SubagentTaskManager | null): void {
  globalThis.__piSubagentTaskManager = manager ?? undefined;
}
