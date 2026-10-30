import type { SubagentTaskOrigin, SubagentTaskStatus } from "../shared/types";
import type { MessageOrigin } from "../shared/message-origin";
import { readSessionName } from "./session-names";
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

export type SubagentManualInputErrorCode =
  | "not-subagent"
  | "busy"
  | "stopping"
  | "invalid"
  | "unavailable";

export class SubagentManualInputError extends Error {
  readonly code: SubagentManualInputErrorCode;

  constructor(code: SubagentManualInputErrorCode, message: string) {
    super(message);
    this.name = "SubagentManualInputError";
    this.code = code;
  }
}

const MANUAL_DESCRIPTION_MAX = 80;

const MANUAL_FOLLOW_UP_DESCRIPTION = "Manual follow-up";

const MANUAL_REQUEST_PREFIX = "manual:";

export interface SubagentSessionOwner {
  parentSessionId: string;
  latestTask: SubagentTask;
}

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

export function findSubagentSessionOwner(childSessionId: string): SubagentSessionOwner | null {
  const latestTask = getSubagentTaskByChildSessionId(childSessionId);
  if (!latestTask) return null;
  return { parentSessionId: latestTask.parentSessionId, latestTask };
}

export function isSubagentChildSession(sessionId: string): boolean {
  return findSubagentSessionOwner(sessionId) !== null;
}

export interface SubagentManualTaskResult extends SubagentTaskProgress {
  parentSessionId: string;
  origin: Extract<SubagentTaskOrigin, "manual">;
  deduped: boolean;
}

export interface SubmitSubagentManualPromptInput {
  childSessionId: string;
  message: string;
  requestId?: string | null;
  hasImages?: boolean;
}

function manualRequestId(requestId: string | null | undefined): string | null {
  const trimmed = requestId?.trim() ?? "";
  return trimmed.length > 0 ? `${MANUAL_REQUEST_PREFIX}${trimmed}` : null;
}

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

  const messageOrigin: MessageOrigin = {
    kind: "subagent-session",
    parentSessionId,
    parentSessionTitle: readSessionName(parentSessionId)?.name ?? parentSessionId,
    childSessionId: input.childSessionId,
  };

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
      messageOrigin,
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
    throw new SubagentManualInputError("unavailable", text);
  }

  return {
    ...progress,
    parentSessionId,
    origin: "manual",
    deduped: false,
  };
}

export interface SubagentManualStopResult {
  taskId: string;
  status: SubagentTaskStatus;
}

export function stopSubagentTaskForChildSession(
  childSessionId: string,
  reason: string = SUBAGENT_CANCELLED,
  manager: SubagentTaskManager = getSubagentTaskManager(),
): SubagentManualStopResult | null {
  const owner = findSubagentSessionOwner(childSessionId);
  if (!owner || isSubagentTerminalStatus(owner.latestTask.status)) return null;
  const taskId = owner.latestTask.taskId;
  manager.stop(owner.parentSessionId, taskId, reason);
  const after = manager.get(owner.parentSessionId, taskId) ?? owner.latestTask;
  return { taskId: after.taskId, status: after.status };
}
