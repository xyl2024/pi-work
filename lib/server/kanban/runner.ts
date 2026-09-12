/**
 * Executes one Kanban task as a background pi session.
 *
 * Optimistically (and, thanks to the store's status guard, race-free):
 *   - cold-start a fresh pi session via startRpcSession,
 *   - record the real session id so the card can open it,
 *   - send the configured prompt,
 *   - wait for the terminal agent_end,
 *   - move the card to review_test (success carries a result summary; a
 *     failed/aborted run also lands in review_test but with an `error` set
 *     per the product decision — the user manually decides what to do next).
 *
 * Concurrency: a per-task FIFO chain prevents the same task from ever
 * running twice in parallel; different tasks run independently (parallelism
 * is the whole point of a Kanban board).
 */

import { existsSync } from "fs";
import { startRpcSession } from "@/lib/server/rpc-manager";
import type { AgentEvent } from "@/lib/server/rpc-manager";
import { markRunEnd, setRunSessionId } from "./store";
import type { KanbanTask } from "@/lib/shared/kanban-types";

/** Safety net for a stuck agent that never reports back. Big enough that no
 *  real task should hit it, small enough that a runaway agent won't pin a
 *  process slot forever. */
const DEFAULT_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

interface TextBlock { type: string; text?: string }
interface AssistantMsg {
  role: string;
  content: Array<{ type: string; text?: string }>;
  stopReason?: string;
  errorMessage?: string;
}

class MaxLifetimeExceededError extends Error {
  constructor(public readonly maxLifetimeMs: number) {
    super(`max lifetime exceeded: ${maxLifetimeMs}ms`);
    this.name = "MaxLifetimeExceededError";
  }
}

class SessionInterruptedError extends Error {
  constructor() {
    super("agent session destroyed before agent_end");
    this.name = "SessionInterruptedError";
  }
}

/** Per-task FIFO chain so two overlapping starts don't run concurrently. */
const taskChains = new Map<string, Promise<void>>();

export function runTask(task: KanbanTask): Promise<void> {
  const prev = taskChains.get(task.id) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(() => executeRun(task));
  taskChains.set(task.id, next);
  return next;
}

async function executeRun(task: KanbanTask): Promise<void> {
  // The route already flipped the task to in_progress via markRunStart, but
  // keep the cwd check here too so a stray run never half-executes.
  if (!existsSync(task.cwd)) {
    markRunEnd(task.id, {
      status: "review_test",
      error: `cwd missing: ${task.cwd}`,
    });
    return;
  }

  let sessionId: string | null = null;
  try {
    const tempKey = `__kanban__${task.id}_${Date.now()}`;
    const { session, realSessionId } = await startRpcSession(
      tempKey,
      "",
      task.cwd,
      task.toolNames ?? "all",
      "scheduled", // background run — attributed like other scheduled work
    );
    sessionId = realSessionId;
    setRunSessionId(task.id, sessionId);

    if (task.provider && task.modelId) {
      await session.send({ type: "set_model", provider: task.provider, modelId: task.modelId });
    }
    if (task.thinkingLevel) {
      await session.send({ type: "set_thinking_level", level: task.thinkingLevel });
    }

    const waiter = waitForAgentReply(session);
    void session.send({ type: "prompt", message: task.prompt }).catch((err: unknown) => {
      waiter.fail(err instanceof Error ? err : new Error(String(err)));
    });
    const reply = await waiter.promise;

    markRunEnd(task.id, {
      status: "review_test",
      resultSummary: reply ? reply.slice(0, 2000) : null,
      error: null,
    });
  } catch (err) {
    const errorStr = err instanceof Error ? err.message : String(err);
    markRunEnd(task.id, {
      status: "review_test",
      resultSummary: null,
      error: errorStr.slice(0, 2000),
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

/** Subscribe to the wrapper, resolve on agent_end with the last assistant
 *  text, and force-destroy on a max-lifetime timeout so a stuck agent can't
 *  pin a slot. Mirrors scheduler/runner.ts:waitForAgentReply. */
function waitForAgentReply(session: SessionWithDestroy): AgentReplyWaiter {
  let done = false;
  let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe = () => {};
  let removeDestroyListener = () => {};
  let destroyingForTimeout = false;
  let resolvePromise: (reply: string) => void = () => {};
  let rejectPromise: (err: Error) => void = () => {};

  const promise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
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
    fail(new SessionInterruptedError());
  };

  lifetimeTimer = setTimeout(() => {
    destroyingForTimeout = true;
    try {
      session.destroy();
    } catch {
      /* best-effort */
    }
    finish(new MaxLifetimeExceededError(DEFAULT_MAX_LIFETIME_MS), "");
  }, DEFAULT_MAX_LIFETIME_MS);

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
      fail(new Error("agent ended without a messages snapshot"));
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
      if (!text.trim()) {
        fail(new Error("agent ended without a final assistant reply"));
        return;
      }
      finish(null, text);
      return;
    }
    finish(null, "");
  });
  removeDestroyListener = session.onDestroy(onDestroy);

  return { promise, fail };
}