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
  SUBAGENT_RESULT_WINDOW_MAX,
  type SubagentProfile,
  type SubagentTaskConfigSnapshot,
} from "../shared/subagent";
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

/**
 * A stored result always fills at least one read window, so raising the window
 * can never expose a cap the window itself cannot serve.
 */
const MAX_RESULT_LENGTH = SUBAGENT_RESULT_WINDOW_MAX;
const SUBAGENT_CUSTOM_ENTRY = "pi_work_subagent";

const log = createLogger("subagent/tasks");

/**
 * The cancel wording shared with the tool call's abort source. Kept next to the
 * task manager because the manager owns the stop now, not the tool.
 */
export const SUBAGENT_CANCELLED = "Subagent cancelled";

/** Session-closed wording (kept verbatim from the pre-lifecycle tool). */
export const SUBAGENT_SESSION_CLOSED_ERROR = "Subagent stopped because the subagent session was closed";

/** Reason recorded when the user's stop-all (or the parent turn's stop) cascades. */
export const SUBAGENT_PARENT_STOPPED = "Subagent stopped because the parent session was stopped";

/** Reason recorded when deleting the parent session cancels its unfinished tasks. */
export const SUBAGENT_PARENT_DELETED = "Subagent stopped because the parent session was deleted";

/** Wording when a child session already has an unfinished task. */
export const SUBAGENT_SESSION_BUSY =
  "This subagent session is busy: it already has a queued, creating, running or stopping task."
  + " Wait for that task to finish (or cancel it) before continuing the session; inputs are never queued or steered into a running turn.";

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
    tools: restrictSubagentTools(input.profile.tools),
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
  /** Who supplied the input: the parent agent (`tool`) or the user (`manual`). */
  origin: SubagentTaskOrigin;
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
  /** Optional dedupe key: a retry with the same id returns the same task. */
  requestId?: string | null;
  /** Called on every status change while the task is unfinished. */
  onProgress?: (progress: SubagentTaskProgress) => void;
}

export interface ContinueSubagentTaskInput {
  parentSessionId: string;
  /** The existing child session to continue (its newest task must be terminal). */
  childSessionId: string;
  description: string;
  /** The new turn's input. Old prompts, results and timings are never touched. */
  prompt: string;
  /** Optional dedupe key: a retry with the same id returns the same task. */
  requestId?: string | null;
  /** Who supplied the input; absent means the parent agent (`tool`). */
  origin?: SubagentTaskOrigin;
  onProgress?: (progress: SubagentTaskProgress) => void;
}

export interface WaitSubagentTaskOptions {
  /** How long to observe; 0 returns immediately. */
  timeoutMs?: number;
  /**
   * Stop the task if this fires while the caller is still waiting. A caller
   * that already returned owns no stop. Session-level entry points (the user's
   * stop-all, session deletion) call `stopAll()` directly; this option stays
   * the tool path's own contribution for a spawn whose wait was abandoned.
   */
  stopOnAbort?: { signal: AbortSignal; reason: string };
  /**
   * End the observation if this fires, without touching the task. Used by a
   * `wait` on an existing task: the caller's turn was stopped, so the wait must
   * return promptly, but the task keeps running and holds its slot.
   */
  observeAbort?: AbortSignal;
}

/** What a session-level stop reached, and whether its window is still open. */
export interface StopAllSubagentResult {
  stopped: number;
  stopping: boolean;
}

export interface SubagentTaskManager {
  /** Create a task and schedule it. Returns immediately; use `wait` to observe. */
  spawn(input: SpawnSubagentTaskInput): SubagentTaskProgress;
  /**
   * Start a new task in an existing child session, reusing the configuration
   * frozen when that session was created. A busy session (any unfinished task)
   * is refused instead of queued into the running turn.
   */
  continue(input: ContinueSubagentTaskInput): SubagentTaskProgress;
  /** Observe a task up to `timeoutMs`; never cancels or unmanages it. */
  wait(taskId: string, options?: WaitSubagentTaskOptions): Promise<SubagentTaskWaitResult>;
  /**
   * Ask a task to stop. Terminal tasks are left alone (a late cancel must not
   * overwrite a finished result); a queued task is cancelled without starting.
   */
  stop(taskId: string, reason?: string): void;
  /**
   * Stop every unfinished task of one parent (running and queued) and refuse
   * new spawns for that parent until the last stop is confirmed. Used by the
   * user's parent-session stop and by parent-session deletion.
   */
  stopAll(parentSessionId: string, reason?: string): StopAllSubagentResult;
  /** True while a stop-all for this parent still has tasks to confirm. */
  isStopping(parentSessionId: string): boolean;
  /** The persisted row, or null. */
  get(taskId: string): SubagentTask | null;
  /**
   * Live status of a task this process still manages, or null when the process
   * is not managing it (finished, never started here, or from a dead process).
   * Read-side queries use it to avoid reporting stale non-terminal rows.
   */
  liveStatus(taskId: string): SubagentTaskStatus | null;
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
  /** `reuse` for every later turn of a child session, `fresh` for spawn. */
  session?: TurnSessionPolicy;
}) => Promise<AcquiredTurnSession & { session: SubagentChildSession }>;

/** Timer seam: tests drive the wait deadline without waiting 15 minutes. */
export interface SubagentTaskTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SubagentTaskManagerDeps {
  /** The turn seam; tests substitute a scripted adapter. */
  runTurn: typeof runTurn;
  /**
   * Reconcile leftover non-terminal rows when the manager is created (at most
   * once per process; the server-start hook normally did this already).
   */
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
  /** Set for a continued task: its turn runs in this existing child session. */
  reusedSessionId: string | null;
  status: SubagentTaskStatus;
  /**
   * The configuration this task runs with. Null only between `continue` and
   * the start of a legacy task's turn, where the restricted config is recovered
   * asynchronously from the child session's own persisted files.
   */
  config: SubagentTaskConfigSnapshot | null;
  /** Profile name recorded on the task row (available before the config is). */
  subagentName: string;
  description: string;
  prompt: string;
  origin: SubagentTaskOrigin;
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

/** A progress snapshot from a persisted row (dedupe replay / stale rows). */
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

/** One rule for the optional dedupe key: trimmed, empty means absent. */
function normalizeRequestId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/** A unique-index race, which dedupe can resolve by reading the winner. */
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

/**
 * Reopen (or adopt) a child session for reading and interaction — a tab, an
 * event stream, a non-prompt command — with the configuration frozen when it was
 * created, never today's profile, the parent's prompt or the cwd defaults.
 *
 * Returns null when the id is not a child session of any parent, or when its
 * session file is gone; the caller then follows its ordinary path. A row that
 * predates configuration snapshots is reopened with only what its own persisted
 * files prove; when even that is unavailable the session is opened with no
 * tools and the `subagent` identity, so viewing history can never widen it (an
 * execution attempt then fails loudly in `continue`).
 */
export async function openSubagentChildSession(
  sessionId: string,
): Promise<AgentSessionWrapper | null> {
  // Dynamic imports, same reason as the factory below: rpc-manager loads this
  // module, so a static edge back into it would close the cycle.
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
    // Read-only safety net: no recoverable creation-time settings, so no tools.
    // Any prompt goes through `continue`, which refuses explicitly rather than
    // running with today's defaults.
    const { session } = await startRpcSession(
      sessionId,
      sessionFile,
      headerCwd ?? process.cwd(),
      [],
      "subagent",
      {
        // A neutral prompt keeps APPEND_SYSTEM.md and generated sections out,
        // matching every other subagent start; no tool is exposed.
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

/**
 * Production child-session acquisition: a fresh session per task, under its own
 * registry key, with the frozen profile config and the *narrowed* tool set.
 * Lives here (not in the tool) because later turns of the same child session
 * reuse the same snapshot through this one path.
 */
const startSubagentChildSession: SubagentChildSessionFactory = async (input) => {
  // Dynamic import: this module is imported by the tool, which rpc-manager
  // loads; a static edge would close the cycle.
  const { getRpcSession, startRpcSession } = await import("./rpc-manager");
  const config = input.config;
  const tools = restrictSubagentTools(config.tools);
  const options = subagentChildSessionStartOptions(config, input.parentSessionId);

  // Continue: run the next turn in the child session the caller named. A live
  // wrapper is handed over as-is; otherwise the session file is reopened with
  // the frozen config (a cold start must not widen the child's capabilities).
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
    `__subagent__${input.taskId}`,
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
  /** FIFO of task ids waiting for a slot. */
  const queue: string[] = [];
  let active = 0;
  /**
   * Parents whose stop-all is still waiting for confirmations. A spawn or a
   * continue during this window is refused: the user asked for everything to
   * stop, so starting (or joining) a task now would silently defeat the stop.
   * Cleared as soon as the parent has no unfinished managed task left.
   */
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
    releaseParentStopIfIdle(task.parentSessionId);
    pump();
  };

  /** A stop-all ends when its last task reached a terminal state. */
  const releaseParentStopIfIdle = (parentSessionId: string) => {
    if (!stoppingParents.has(parentSessionId)) return;
    for (const task of running.values()) {
      if (task.parentSessionId === parentSessionId && !task.finished) return;
    }
    stoppingParents.delete(parentSessionId);
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
  const finalize = async (task: RunningTask, result: TurnResult, config: SubagentTaskConfigSnapshot) => {
    const end = toSubagentEnd(result, config.timeoutMs);
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

  /**
   * The configuration a task runs with, recovering a legacy task's restricted
   * settings right before its first turn. The recovered config is frozen onto
   * the row, so later continues reuse it instead of re-deriving it (or falling
   * back to today's profile). A recovery that cannot prove the tool set or model
   * fails the task instead of running it with wider defaults.
   */
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
      // The parent cannot read these caveats in the tool result, but an
      // operator can see why this child runs with a neutral prompt or the
      // default runtime limit.
      log.warn("recovered a legacy subagent configuration", {
        taskId: task.taskId,
        childSessionId: task.reusedSessionId,
        notes: restored.notes,
      });
    }
    if (!setSubagentTaskConfigSnapshot(task.taskId, JSON.stringify(restored.config))) {
      // A terminal row cannot be given a config: the stop/complete already won,
      // so the recovered settings must not be applied to a new turn.
      throw new Error("This subagent task is no longer active; the recovered configuration was not applied.");
    }
    task.config = restored.config;
    return restored.config;
  };

  const startTask = async (task: RunningTask) => {
    task.started = true;

    markSubagentStatus(task.taskId, "creating");
    setStatus(task, "creating");
    let config = task.config;
    if (!config) {
      // Only a legacy task takes this branch; a stored config never yields
      // before the turn starts, so the queue keeps its synchronous handoff.
      try {
        config = await ensureTaskConfig(task);
      } catch (error) {
        finishTerminal(task, "failed", error instanceof Error ? error.message : String(error));
        return;
      }
      // A stop can land while the legacy config is being recovered; the child
      // session must not be opened for a task the user already stopped.
      if (task.stop.signal.aborted) {
        finishTerminal(task, "cancelled", task.stopReason ?? SUBAGENT_CANCELLED);
        return;
      }
    }

    const registryKey = `__subagent__${task.taskId}`;
    const displayName = `[Subagent] ${task.description}`;
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
      // A child wrapper destroyed from outside (deleted from the UI, idle
      // reap) ends the run as interrupted; it is not a user stop.
      childRun.offDestroy = acquired.session.onDestroy(() => childGone.abort());
      // Publish the id before the prompt so a waiting caller can follow the
      // child's activity from the moment it exists.
      task.childSessionId = acquired.realSessionId;
      markSubagentRunning(task.taskId, acquired.realSessionId);
      setStatus(task, "running");
      // A continued task reuses the session (and its name) as-is; only the
      // first turn names the newly created child.
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
          // A continued task runs its next turn in the existing child session;
          // the frozen config below still supplies model, thinking, tools and
          // runtime limit for this turn. A live wrapper must be asked for the
          // snapshot's model/thinking again so an earlier turn cannot leave it
          // on a different setting.
          ...(task.reusedSessionId
            ? {
              session: { kind: "reuse" as const, sessionId: task.reusedSessionId },
              model: config.model,
              thinkingLevel: config.thinkingLevel,
            }
            : {}),
          // The runtime limit starts here, with the turn — never with the queue,
          // and every continued turn gets a fresh allowance.
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

  /**
   * Persist one task and put it on the queue. Request-id dedupe is checked
   * before the insert and again when the insert loses a race (the unique index
   * is the authority), so a retry never starts a second task even across a
   * process restart.
   */
  const createManagedTask = (input: {
    parentSessionId: string;
    description: string;
    prompt: string;
    /**
     * The frozen config, or null for a legacy continue: its restricted config is
     * recovered from the child session's persisted files before the turn starts
     * (see `ensureTaskConfig`).
     */
    config: SubagentTaskConfigSnapshot | null;
    subagentName: string;
    childSessionId: string | null;
    reusedSessionId: string | null;
    requestId?: string | null;
    origin?: SubagentTaskOrigin;
    onProgress?: (progress: SubagentTaskProgress) => void;
  }): SubagentTaskProgress => {
    const requestId = normalizeRequestId(input.requestId);
    if (requestId) {
      const existing = getSubagentTaskByRequestId(input.parentSessionId, requestId);
      if (existing) return progressOfRow(existing);
    }

    const taskId = `subagent:${randomUUID()}`;
    try {
      createSubagentTask({
        taskId,
        parentSessionId: input.parentSessionId,
        childSessionId: input.childSessionId,
        subagentName: input.subagentName,
        description: input.description,
        prompt: input.prompt,
        origin: input.origin ?? "tool",
        requestId,
        configSnapshot: input.config ? JSON.stringify(input.config) : null,
      });
    } catch (error) {
      // A concurrent retry can win the unique index between the check above
      // and this insert; return that task instead of failing the retry. Any
      // other database failure stays an error.
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

  const spawn = (input: SpawnSubagentTaskInput): SubagentTaskProgress => {
    // A retry of an existing request is not new work: return the original even
    // while a stop window is open, so the caller can still collect it.
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
        // A request id is scoped to its parent and to the session it first
        // continued; reusing it for another session is refused rather than
        // silently reading/steering a different child.
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

    // A child session has at most one unfinished task: queued, creating,
    // running and stopping all count. The input is never appended to, steered
    // into, or queued behind the running turn.
    const busy = [...running.values()].find(
      (task) => task.parentSessionId === input.parentSessionId
        && task.childSessionId === input.childSessionId
        && !task.finished,
    );
    if (busy) throw new Error(SUBAGENT_SESSION_BUSY);

    const snapshotJson = getSubagentSessionConfigSnapshot(input.parentSessionId, input.childSessionId);
    // A legacy child may predate snapshots. Keep the freeze rule: reuse the
    // creation-time snapshot when there is one; otherwise the task starts with
    // no config and recovers only what the child session's own persisted files
    // prove (and fails explicitly when the restricted tool set is unknown).
    const config = parseSubagentConfigSnapshot(snapshotJson);
    if (!config) {
      // A legacy child: refuse synchronously when the restricted tool set is
      // already known to be unrecoverable, instead of queueing a task that can
      // only fail later. The remaining checks (session file, model) need I/O
      // and are repeated right before the turn starts.
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
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });
  };

  const wait = async (taskId: string, options: WaitSubagentTaskOptions = {}): Promise<SubagentTaskWaitResult> => {
    const row = getSubagentTask(taskId);
    if (!row) throw new Error(`No subagent task with id "${taskId}"`);
    // A terminal row is final: a late event must not resurrect it, and a
    // finished task is reported at once without touching the turn again.
    if (isSubagentTerminalStatus(row.status)) return asWaitResult(row, false);
    const task = running.get(taskId);
    if (!task || task.finished) {
      // A non-terminal row this process does not manage cannot still be
      // running (a restart, or a manager that never adopted it). Report the
      // honest state instead of echoing a stale `running` database value.
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
      // The caller is going away; that is a stop request for this task, not a
      // reason to forget it. The stop is confirmed by the turn module.
      stop(taskId, options.stopOnAbort?.reason);
    }

    const current = getSubagentTask(taskId) ?? row;
    // An aborted observation reports the task's current state as-is: waiting is
    // an observation, so its cancellation never cancels the task.
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

  const stopAll = (parentSessionId: string, reason = SUBAGENT_PARENT_STOPPED): StopAllSubagentResult => {
    // Enter the stopping window before touching any row: a spawn racing this
    // call (after an await in the tool path) must be refused, not queued up
    // behind a stop the user already asked for.
    stoppingParents.add(parentSessionId);
    let stopped = 0;
    try {
      // Rows are the authority: they also cover a non-terminal row this process
      // does not manage (a stale row is settled honestly as cancelled).
      for (const row of listSubagentTasks(parentSessionId)) {
        if (isSubagentTerminalStatus(row.status)) continue;
        stop(row.taskId, reason);
        stopped += 1;
      }
    } finally {
      // Never leave the parent wedged in a stopping window after the call: if
      // tasks remain unfinished the window stays (honestly), otherwise it ends.
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
    get: (taskId) => getSubagentTask(taskId),
    liveStatus: (taskId) => running.get(taskId)?.status ?? null,
    idle,
  };
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

/**
 * The already-created manager, or null. Session entry points that merely need
 * to cascade a stop (parent abort, parent deletion) use this so they never
 * create a manager — and never trigger startup reconciliation — as a side
 * effect of stopping. With no manager there are no live tasks to stop.
 */
export function getExistingSubagentTaskManager(): SubagentTaskManager | null {
  return globalThis.__piSubagentTaskManager ?? null;
}

/**
 * Stop every unfinished task of a parent, if this process manages any. This is
 * the one session-level stop used by the parent's abort command and by parent
 * deletion, so both reach the same rules as the tool's `cancel` action.
 */
export function stopAllSubagentTasksForParent(
  parentSessionId: string,
  reason = SUBAGENT_PARENT_STOPPED,
): StopAllSubagentResult {
  const manager = getExistingSubagentTaskManager();
  if (!manager) return { stopped: 0, stopping: false };
  return manager.stopAll(parentSessionId, reason);
}

/** Test seam: replace / clear the process-wide manager. */
export function setSubagentTaskManagerForTests(manager: SubagentTaskManager | null): void {
  globalThis.__piSubagentTaskManager = manager ?? undefined;
}
