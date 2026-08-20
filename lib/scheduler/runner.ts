/**
 * Executes one scheduled task: cold-start a fresh pi session, send the
 * configured prompt, wait for the real `agent_end`, and record the
 * outcome on the pre-created `task_runs` row.
 *
 * Pattern mirrors `lib/wechat/inbound.ts:coldStart` + `waitForAgentReply`
 * without the 5-minute blanket timeout: the scheduler waits as long as
 * the real agent needs to finish. The only cap is the task's
 * `maxLifetimeMs` (or the global default), which is a safety net that
 * force-destroys the wrapper if the agent truly never reports back.
 *
 * Concurrency: a per-task FIFO chain (`taskChains`) prevents the same task
 * from running twice in parallel if a previous run is still in flight.
 * Different tasks run independently.
 */

import { existsSync } from "fs";
import { startRpcSession } from "@/lib/rpc-manager";
import type { AgentEvent } from "@/lib/rpc-manager";
import { recordRunEnd, type ScheduledTask } from "./store";
import { pushMessage } from "@/lib/inbox-store";
import { createLogger } from "../logger";

const log = createLogger("scheduler/runner");

/**
 * Global fallback for the per-task max lifetime. The scheduler really does
 * wait for the real `agent_end` — the previous 5-min blanket timeout was
 * killing legitimate long-running tasks mid-flight. This default is just
 * a safety net for a stuck agent that never reports back; pick it big
 * enough that no real task should hit it, but small enough that a runaway
 * agent can't pin a slot forever.
 */
const DEFAULT_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

interface TextBlock { type: string; text?: string }
interface AssistantMsg {
  role: string;
  content: Array<{ type: string; text?: string }>;
  stopReason?: string;
  errorMessage?: string;
}

/** Thrown by waitForAgentReply when the per-task max lifetime is reached
 *  and the wrapper is force-destroyed. The executeRun catch maps this to
 *  status="timeout" via instanceof (not a regex on the message), so the
 *  status enum stays a deliberate signalling choice rather than a string
 *  match against an error message. */
class MaxLifetimeExceededError extends Error {
  constructor(public readonly maxLifetimeMs: number) {
    super(`max lifetime exceeded: ${maxLifetimeMs}ms`);
    this.name = "MaxLifetimeExceededError";
  }
}

/** The wrapper disappeared before pi emitted its terminal agent_end event. */
class SessionInterruptedError extends Error {
  constructor() {
    super("agent session destroyed before agent_end");
    this.name = "SessionInterruptedError";
  }
}

/** Per-task FIFO chain so two overlapping triggers don't run concurrently. */
const taskChains = new Map<string, Promise<void>>();

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

export function runTask(task: ScheduledTask, runId: string): Promise<void> {
  const prev = taskChains.get(task.id) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined) // never poison the chain
    .then(() => executeRun(task, runId));
  taskChains.set(task.id, next);
  return next;
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
      payload: { body: `cwd missing: ${task.cwd}` },
    });
    return;
  }

  let sessionId: string | null = null;
  try {
    const tempKey = `__sched__${runId}`;
    const { session, realSessionId } = await startRpcSession(
      tempKey,
      "",
      task.cwd,
      task.toolNames ?? "all",
      "scheduled",
    );
    sessionId = realSessionId;
    recordRunEnd(runId, { sessionId, status: "running", durationMs: Date.now() - startedAt });

    if (task.provider && task.modelId) {
      await session.send({ type: "set_model", provider: task.provider, modelId: task.modelId });
    }
    if (task.thinkingLevel) {
      await session.send({ type: "set_thinking_level", level: task.thinkingLevel });
    }

    const maxLifetimeMs = task.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS;
    log.debug("waiting for agent_end", {
      taskId: task.id,
      runId,
      maxLifetimeMs,
      maxLifetimeSource: task.maxLifetimeMs !== null ? "task" : "default",
    });
    // Install the terminal-event listener before dispatching the prompt so a
    // very short turn cannot emit agent_end before the scheduler is listening.
    const waiter = waitForAgentReply(session, runId, maxLifetimeMs);
    void session.send({ type: "prompt", message: task.prompt }).catch((err: unknown) => {
      waiter.fail(err instanceof Error ? err : new Error(String(err)));
    });
    const reply = await waiter.promise;
    const durationMs = Date.now() - startedAt;
    log.info("run success", { taskId: task.id, runId, sessionId, durationMs });
    recordRunEnd(runId, {
      status: "success",
      replyText: reply || null,
      sessionId,
      durationMs,
    });
    safePush(task.id, {
      source: "scheduler",
      level: "info",
      title: task.name,
      payload: { body: reply ? reply.slice(0, 200) : "Task completed" },
    });
  } catch (err) {
    const errorStr = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof MaxLifetimeExceededError;
    const isInterrupted = err instanceof SessionInterruptedError;
    const status = isTimeout ? "timeout" : isInterrupted ? "interrupted" : "error";
    const durationMs = Date.now() - startedAt;
    log.error("run failed", { taskId: task.id, runId, sessionId, status, error: errorStr });
    recordRunEnd(runId, { status, error: errorStr, sessionId, durationMs });
    safePush(task.id, {
      source: "scheduler",
      level: isTimeout || isInterrupted ? "warn" : "error",
      title: task.name,
      payload: { body: errorStr.slice(0, 200) },
    });
  }
}

type SessionWithDestroy = {
  onEvent: (cb: (event: AgentEvent) => void) => () => void;
  onDestroy: (cb: () => void) => () => void;
  destroy: () => void;
};

interface AgentReplyWaiter {
  promise: Promise<string>;
  fail: (err: Error) => void;
}

/**
 * Subscribe to the wrapper's event stream and resolve on `agent_end`,
 * extracting the last assistant message text.
 *
 * No artificial agent_end timeout — we wait for the real result. The
 * `maxLifetimeMs` cap is a safety net: if the agent truly never reports
 * back (stuck loop, network hang, etc.) we force-destroy the wrapper so
 * the slot is freed and the run is recorded as `timeout`. The actual
 * return value is otherwise the real assistant text from the agent.
 *
 * Mirrors `lib/wechat/inbound.ts:waitForAgentReply` in spirit (event
 * subscription + single resolution) but without the 5-min blanket cap.
 */
function waitForAgentReply(
  session: SessionWithDestroy,
  runId: string,
  maxLifetimeMs: number,
): AgentReplyWaiter {
  let done = false;
  let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe = () => {};
  let removeDestroyListener = () => {};
  let destroyingForTimeout = false;
  let resolvePromise: (reply: string) => void = () => {};
  let rejectPromise: (err: Error) => void = () => {};

  const promise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = (err) => reject(err);
  });

  const finish = (err: Error | null, reply: string) => {
    if (done) return;
    done = true;
    if (lifetimeTimer !== null) clearTimeout(lifetimeTimer);
    unsubscribe();
    removeDestroyListener();
    if (err) rejectPromise(err);
    else resolvePromise(reply);
  };

  const fail = (err: Error) => finish(err, "");

  const onDestroy = () => {
    if (destroyingForTimeout) return;
    log.warn("agent session destroyed before agent_end", { runId });
    fail(new SessionInterruptedError());
  };

  lifetimeTimer = setTimeout(() => {
    log.warn("max lifetime reached, destroying wrapper", {
      runId,
      maxLifetimeMs,
    });
    // Force-destroy so the agent actually stops (otherwise a stuck
    // session would keep the slot pinned and the model provider would
    // continue to be billed). The session file on disk is left as-is
    // for post-mortem — the recorded sessionId lets the user inspect
    // whatever the agent had actually written.
    destroyingForTimeout = true;
    try {
      session.destroy();
    } catch (err) {
      log.warn("destroy failed during lifetime cap", { runId, error: String(err) });
    }
    finish(new MaxLifetimeExceededError(maxLifetimeMs), "");
  }, maxLifetimeMs);

  // Register both listeners before the prompt is dispatched. This closes
  // the short-task race where agent_end could otherwise arrive first.
  unsubscribe = session.onEvent((event: AgentEvent) => {
    if (event.type === "prompt_failed") {
      const message = typeof event.error === "string" && event.error
        ? event.error
        : "prompt failed";
      fail(new Error(message));
      return;
    }
    if (event.type !== "agent_end") return;
    const error = typeof event.error === "string" ? event.error : null;
    if (error) {
      fail(new Error(error));
      return;
    }
    const messages = Array.isArray((event as Record<string, unknown>).messages)
      ? ((event as Record<string, unknown>).messages as AssistantMsg[])
      : null;
    if (!messages) {
      // No messages snapshot — treat as success with empty reply so the run
      // is recorded. This can happen if pi changed its event shape.
      log.warn("agent_end without messages snapshot", { runId });
      finish(null, "");
      return;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      if (m.stopReason === "error" || m.stopReason === "aborted") {
        fail(new Error(m.errorMessage || `assistant stopReason=${m.stopReason}`));
        return;
      }
      const text = m.content
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      finish(null, text);
      return;
    }
    finish(null, "");
  });
  removeDestroyListener = session.onDestroy(onDestroy);

  return { promise, fail };
}
