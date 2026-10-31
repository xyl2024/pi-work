import { existsSync } from "fs";
import { runTurnRpcSession, type RunTurnRpcSpec } from "@/lib/server/rpc-manager";
import type { MessageOrigin } from "@/lib/shared/message-origin";
import { runSerial } from "@/lib/server/serial-chain";
import { recordRunEnd, type ScheduledTask } from "./store";
import { toRunEnd } from "./run-end";
import { notify, shouldNotify } from "@/lib/server/notifications";
import { createLogger } from "../logger";

const log = createLogger("scheduler/runner");

const DEFAULT_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

function dispatchNotifications(
  task: ScheduledTask,
  outcome: "success" | "error" | "timeout",
  text: string,
  detail: string,
  runId?: string,
): void {
  if (!shouldNotify(task.notification, outcome)) return;
  void notify(task.notification!, {
    taskId: task.id,
    taskName: task.name,
    outcome,
    text,
    detail,
    runId,
  }).catch((err) => {
    log.warn("notification dispatch failed", { taskId: task.id, error: String(err) });
  });
}

export function runTask(task: ScheduledTask, runId: string): Promise<void> {
  return runSerial(task.id, () => executeRun(task, runId));
}

async function executeRun(task: ScheduledTask, runId: string): Promise<void> {
  const startedAt = Date.now();
  log.info("run start", { taskId: task.id, runId, cwd: task.cwd });

  if (!existsSync(task.cwd)) {
    const msg = `cwd missing: ${task.cwd}`;
    log.error("run aborted", { taskId: task.id, runId, error: msg });
    recordRunEnd(runId, { status: "error", error: msg, durationMs: Date.now() - startedAt });
    dispatchNotifications(task, "error", msg, msg, runId);
    return;
  }

  const maxLifetimeMs = task.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS;
  log.debug("waiting for agent_settled", {
    taskId: task.id,
    runId,
    maxLifetimeMs,
    maxLifetimeSource: task.maxLifetimeMs !== null ? "task" : "default",
  });

  let sessionId: string | null = null;

  try {
    const result = await runTurnRpcSession({
      cwd: task.cwd,
      prompt: task.prompt,
      ...(task.provider && task.modelId
        ? { model: { provider: task.provider, modelId: task.modelId } }
        : {}),
      ...(task.thinkingLevel
        ? { thinkingLevel: task.thinkingLevel as RunTurnRpcSpec["thinkingLevel"] }
        : {}),
      toolNames: task.toolNames ?? "all",
      permissionMode: task.permissionMode,
      origin: {
        kind: "scheduled-task",
        taskId: task.id,
        name: task.name,
      } satisfies MessageOrigin,
      source: "scheduled",
      timeoutMs: maxLifetimeMs,
      onSession: ({ realSessionId }) => {
        sessionId = realSessionId;
        recordRunEnd(runId, { sessionId, status: "running", durationMs: Date.now() - startedAt });
      },
    });

    const durationMs = Date.now() - startedAt;
    const end = toRunEnd(result, task.name);
    if (end.status === "success") {
      log.info("run success", { taskId: task.id, runId, sessionId, durationMs });
    } else {
      log.error("run failed", { taskId: task.id, runId, sessionId, status: end.status, error: end.error });
    }
    recordRunEnd(runId, {
      status: end.status,
      replyText: end.replyText,
      error: end.error,
      sessionId,
      durationMs,
    });
    if (end.notification) {
      dispatchNotifications(task, end.notification.outcome, end.notification.text, end.notification.detail, runId);
    }
  } catch (err) {
    const errorStr = err instanceof Error ? err.message : String(err);
    const end = toRunEnd({ status: "failed", text: "", hasReply: false, error: errorStr }, task.name);
    const durationMs = Date.now() - startedAt;
    log.error("run failed", { taskId: task.id, runId, sessionId, status: end.status, error: errorStr });
    recordRunEnd(runId, {
      status: end.status,
      error: end.error,
      sessionId,
      durationMs,
    });
    if (end.notification) {
      dispatchNotifications(task, end.notification.outcome, end.notification.text, end.notification.detail, runId);
    }
  }
}
