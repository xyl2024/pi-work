/**
 * Manual follow-up: the user typing into a known subagent child session is the
 * same kind of work as the parent agent delegating to it, so it enters the same
 * task manager instead of starting an untracked turn.
 *
 * Why this module exists (ADR-0022, issue 06): the child session's chat input is
 * a *generic* user-input entry — it must obey the rules the tool path already
 * enforces: one unfinished task per child session (busy is refused, input is
 * never appended or steered into a running turn), the global concurrency queue,
 * request-based dedupe, the parent's stop-all window, and the configuration
 * frozen when the child session was created. The child stays a subagent; it is
 * never converted into an ordinary session and its permission mode is never
 * raised from here.
 *
 * Deliberately thin: nothing here starts a turn itself. Every manual input goes
 * through `SubagentTaskManager.continue`, which owns scheduling, the turn seam,
 * the recorded task row and confirmation of a stop.
 */
import type { SubagentTaskOrigin, SubagentTaskStatus } from "../shared/types";
import {
  getSubagentTaskByChildSessionId,
  getSubagentTaskByRequestId,
  isSubagentTerminalStatus,
  type SubagentTask,
} from "./subagent-store";
import {
  getSubagentTaskManager,
  SUBAGENT_CANCELLED,
  SUBAGENT_SESSION_BUSY,
  type SubagentTaskManager,
  type SubagentTaskProgress,
} from "./subagent-tasks";

/** Failure codes a user-input entry point can map onto an HTTP status. */
export type SubagentManualInputErrorCode =
  /** The session is not a known direct child session of any parent. */
  | "not-subagent"
  /** The child already has a queued, creating, running or stopping task. */
  | "busy"
  /** The parent's stop-all is still confirming; new work is refused. */
  | "stopping"
  /** The input cannot be delivered (empty text, images, reused request id…). */
  | "invalid"
  /** A live task refused the input for a reason of its own (e.g. no snapshot). */
  | "unavailable";

/** A manual-input refusal the caller reports as-is instead of a 500. */
export class SubagentManualInputError extends Error {
  readonly code: SubagentManualInputErrorCode;

  constructor(code: SubagentManualInputErrorCode, message: string) {
    super(message);
    this.name = "SubagentManualInputError";
    this.code = code;
  }
}

/** Longest description recorded for a manual task (the prompt keeps the rest). */
const MANUAL_DESCRIPTION_MAX = 80;

/** Description fallback when the input has no printable line to summarize. */
const MANUAL_FOLLOW_UP_DESCRIPTION = "Manual follow-up";

/** Request ids from the browser share the parent's dedupe scope with the tool. */
const MANUAL_REQUEST_PREFIX = "manual:";

/** The child session's parent, or null when this is not a child session. */
export interface SubagentSessionOwner {
  parentSessionId: string;
  /** The child session's newest task (what tells us whose child it is). */
  latestTask: SubagentTask;
}

/**
 * One line describing a manual input, for the parent agent's task history. The
 * text is the user's own, so it needs no translation; empty input falls back to
 * a neutral label.
 */
export function manualTaskDescription(message: string): string {
  const firstLine = message
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ");
  if (!collapsed) return MANUAL_FOLLOW_UP_DESCRIPTION;
  return collapsed.length > MANUAL_DESCRIPTION_MAX
    ? `${collapsed.slice(0, MANUAL_DESCRIPTION_MAX - 1)}…`
    : collapsed;
}

/**
 * The owner of a child session, looked up by the authoritative relation (the
 * task rows), never from caller-supplied metadata. A session with no task row is
 * an ordinary session.
 */
export function findSubagentSessionOwner(childSessionId: string): SubagentSessionOwner | null {
  const latestTask = getSubagentTaskByChildSessionId(childSessionId);
  if (!latestTask) return null;
  return { parentSessionId: latestTask.parentSessionId, latestTask };
}

/** True when this session is a known subagent child session. */
export function isSubagentChildSession(sessionId: string): boolean {
  return findSubagentSessionOwner(sessionId) !== null;
}

/** What a manual submission returned: the tracked task plus its provenance. */
export interface SubagentManualTaskResult extends SubagentTaskProgress {
  parentSessionId: string;
  origin: Extract<SubagentTaskOrigin, "manual">;
  /** True when a retried request id returned the task the first submit created. */
  deduped: boolean;
}

export interface SubmitSubagentManualPromptInput {
  /** The child session the user typed into. */
  childSessionId: string;
  /** The user's input, verbatim. */
  message: string;
  /** Optional retry key; scoped to the parent session like the tool's. */
  requestId?: string | null;
  /**
   * Whether the input carries images. A task records a text prompt only, and
   * running it without the images would execute a different turn than the user
   * sent — so this is refused rather than silently dropped.
   */
  hasImages?: boolean;
}

function manualRequestId(requestId: string | null | undefined): string | null {
  const trimmed = requestId?.trim() ?? "";
  return trimmed.length > 0 ? `${MANUAL_REQUEST_PREFIX}${trimmed}` : null;
}

/**
 * Send one manual input into a child session as a tracked task.
 *
 * Synchronous on purpose: the busy check and the task registration happen in one
 * turn of the event loop, so a manual submit racing the parent agent's
 * `continue` can never start two overlapping turns in the same child session.
 */
export function submitSubagentManualPrompt(
  input: SubmitSubagentManualPromptInput,
): SubagentManualTaskResult {
  const manager = getSubagentTaskManager();
  const owner = findSubagentSessionOwner(input.childSessionId);
  if (!owner) {
    throw new SubagentManualInputError(
      "not-subagent",
      `Session "${input.childSessionId}" is not a subagent child session; it does not accept tracked manual input.`,
    );
  }
  const { parentSessionId } = owner;

  if (input.hasImages) {
    throw new SubagentManualInputError(
      "invalid",
      "Manual input to a subagent session cannot carry images; send the instructions as text instead.",
    );
  }

  const message = input.message ?? "";
  if (message.trim().length === 0) {
    throw new SubagentManualInputError(
      "invalid",
      "Manual input to a subagent session must contain text: a task records the prompt it runs.",
    );
  }

  const requestId = manualRequestId(input.requestId);
  if (requestId) {
    const existing = getSubagentTaskByRequestId(parentSessionId, requestId);
    if (existing) {
      // Same rule as the tool's continue: a request id belongs to the session it
      // first continued. Reusing it elsewhere is refused rather than reading or
      // steering a different child.
      if (existing.childSessionId !== input.childSessionId) {
        throw new SubagentManualInputError(
          "invalid",
          "That request_id was already used for a different subagent session; send a new one for this input.",
        );
      }
      return {
        taskId: existing.taskId,
        childSessionId: existing.childSessionId,
        status: existing.status,
        subagentName: existing.subagentName,
        description: existing.description,
        origin: "manual",
        parentSessionId: existing.parentSessionId,
        deduped: true,
      };
    }
  }

  if (manager.isStopping(parentSessionId)) {
    throw new SubagentManualInputError(
      "stopping",
      "The parent session is stopping all subagent tasks; wait for the stop to finish before sending input to a subagent session.",
    );
  }

  let progress: SubagentTaskProgress;
  try {
    progress = manager.continue({
      parentSessionId,
      childSessionId: input.childSessionId,
      description: manualTaskDescription(message),
      prompt: message,
      origin: "manual",
      ...(requestId ? { requestId } : {}),
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text === SUBAGENT_SESSION_BUSY) {
      throw new SubagentManualInputError("busy", text);
    }
    if (manager.isStopping(parentSessionId)) {
      throw new SubagentManualInputError("stopping", text);
    }
    // Not the caller's bad input: the manager refused for its own reasons (a
    // legacy child whose restricted tool set cannot be recovered, an unknown
    // child session, …).
    throw new SubagentManualInputError("unavailable", text);
  }

  return {
    ...progress,
    parentSessionId,
    origin: "manual",
    deduped: false,
  };
}

/** What stopping one child session's task reached. */
export interface SubagentManualStopResult {
  taskId: string;
  status: SubagentTaskStatus;
}

/**
 * The user's stop in a child session stops *that session's* unfinished task —
 * through the task manager, so the row reports `stopping` until the turn
 * confirms it. Returns null when the child has no unfinished task (an idle
 * session has nothing to stop, and a later task is never touched).
 */
export function stopSubagentTaskForChildSession(
  childSessionId: string,
  reason: string = SUBAGENT_CANCELLED,
  manager: SubagentTaskManager = getSubagentTaskManager(),
): SubagentManualStopResult | null {
  const owner = findSubagentSessionOwner(childSessionId);
  if (!owner || isSubagentTerminalStatus(owner.latestTask.status)) return null;
  const taskId = owner.latestTask.taskId;
  manager.stop(taskId, reason);
  const after = manager.get(taskId) ?? owner.latestTask;
  return { taskId: after.taskId, status: after.status };
}
