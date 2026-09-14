/**
 * Executes one scheduled task as a background pi session.
 *
 * The run itself (open a session → apply model/thinking/tools → deliver the
 * prompt → wait until the turn has *really* finished → clean up) goes through
 * the turn module (`lib/server/turn`); this file is the scheduler's adapter: it
 * owns the run vocabulary, the inbox push, the notification and the per-task
 * queue, and nothing else. `agent_settled` is the terminal event, so a task
 * that pi is still retrying (or compaction-retrying, or continuation-running)
 * stays `running` instead of being recorded as finished mid-flight.
 *
 * The scheduler really does wait for the real terminal event — there is no
 * 5-minute blanket timeout. The only cap is the task's `maxLifetimeMs` (or the
 * global default), passed to the turn module as this caller's deadline: a
 * safety net that force-destroys the wrapper if the agent truly never reports
 * back.
 *
 * Concurrency: a per-task FIFO chain (`runSerial`) prevents the same task from
 * running twice in parallel; different tasks run independently.
 */

import { existsSync } from "fs";
import { runTurnRpcSession, type RunTurnRpcSpec } from "@/lib/server/rpc-manager";
import { runSerial } from "@/lib/server/serial-chain";
import { recordRunEnd, type ScheduledTask } from "./store";
import { toRunEnd } from "./run-end";
import { pushMessage } from "@/lib/server/inbox-store";
import { notify, shouldNotify } from "@/lib/server/notifications";
import { createLogger } from "../logger";

const log = createLogger("scheduler/runner");

/**
 * Global fallback for the per-task max lifetime. The scheduler really does
 * wait for the real terminal event — the previous 5-min blanket timeout was
 * killing legitimate long-running tasks mid-flight. This default is just
 * a safety net for a stuck agent that never reports back; pick it big
 * enough that no real task should hit it, but small enough that a runaway
 * agent can't pin a slot forever.
 */
const DEFAULT_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

/**
 * Inbox is a side channel — pushMessage can throw InboxValidationError on
 * malformed input. The scheduler must never be poisoned by inbox failures,
 * so we swallow the error and log it.
 */
function safePush(taskId: string, input: Parameters<typeof pushMessage>[0]): void {
  try {
    pushMessage(input);
  } catch (err) {
    log.warn("inbox push failed", { taskId, error: String(err) });
  }
}

/** Fire task notifications (best-effort, never blocks the run). */
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
    safePush(task.id, {
      source: "scheduler",
      level: "error",
      title: task.name,
      payload: { body: msg },
    });
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

  // The real pi session id is only known once the session exists; record it on
  // the run row as soon as that happens (the turn module announces it before
  // any setup command), so the runs tab can link the session mid-run.
  let sessionId: string | null = null;

  try {
    const result = await runTurnRpcSession({
      cwd: task.cwd,
      prompt: task.prompt,
      ...(task.provider && task.modelId
        ? { model: { provider: task.provider, modelId: task.modelId } }
        : {}),
      // The store only validates that this is a string; keep the pass-through.
      ...(task.thinkingLevel
        ? { thinkingLevel: task.thinkingLevel as RunTurnRpcSpec["thinkingLevel"] }
        : {}),
      // The scheduler always states an explicit selection: the task's own
      // subset, or "all" when it has none. Never "unspecified".
      toolNames: task.toolNames ?? "all",
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
    safePush(task.id, {
      source: "scheduler",
      level: end.push.level,
      title: task.name,
      payload: { body: end.push.body },
    });
    if (end.notification) {
      dispatchNotifications(task, end.notification.outcome, end.notification.text, end.notification.detail, runId);
    }
  } catch (err) {
    // Acquiring the session or preparing it failed before the turn ever
    // started: the run module has no terminal state for that, so the
    // scheduler records it as the failure it is — same shape as a failed turn.
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
    safePush(task.id, {
      source: "scheduler",
      level: end.push.level,
      title: task.name,
      payload: { body: end.push.body },
    });
    if (end.notification) {
      dispatchNotifications(task, end.notification.outcome, end.notification.text, end.notification.detail, runId);
    }
  }
}
