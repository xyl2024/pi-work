/**
 * Executes a single workflow node: cold-start a fresh pi session, send the
 * rendered prompt, wait for the real `agent_end`, and return the final
 * assistant text.
 *
 * The core lifecycle mirrors `lib/server/scheduler/runner.ts` (which powers
 * scheduled tasks) but lives here so the two systems stay decoupled — the
 * workflow engine owns its own copy rather than importing the scheduler's.
 * Same guarantees: no blanket 5-min timeout (we wait for the real result),
 * a `maxLifetimeMs` safety net that force-destroys a stuck wrapper, and
 * distinct outcomes for timeout vs session interruption.
 */

import { existsSync } from "fs";
import { startRpcSession } from "@/lib/server/rpc-manager";
import type { AgentEvent } from "@/lib/server/rpc-manager";
import type { WorkflowNode } from "@/lib/shared/workflow";
import { createLogger } from "../logger";

const log = createLogger("workflow/executor");

/** Global fallback when a node has no explicit maxLifetimeMs. */
const DEFAULT_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

interface TextBlock { type: string; text?: string }
interface AssistantMsg {
  role: string;
  content: Array<{ type: string; text?: string }>;
  stopReason?: string;
  errorMessage?: string;
}

export type NodeRunOutcome =
  | { status: "success"; reply: string; sessionId: string }
  | { status: "timeout"; error: string; sessionId: string | null }
  | { status: "error"; error: string; sessionId: string | null }
  | { status: "interrupted"; error: string; sessionId: string | null };

export interface ExecuteNodeInput {
  /** Stable key used for the agent session. */
  tempKey: string;
  /** The cwd the agent runs in. */
  cwd: string;
  /** Rendered prompt to send. */
  prompt: string;
  node: WorkflowNode;
  runId: string;
}

export async function executeAgentNode(input: ExecuteNodeInput): Promise<NodeRunOutcome> {
  const { tempKey, cwd, prompt, node, runId } = input;
  const startedAt = Date.now();

  if (!existsSync(cwd)) {
    return { status: "error", error: `cwd missing: ${cwd}`, sessionId: null };
  }

  let sessionId: string | null = null;
  try {
    const { session, realSessionId } = await startRpcSession(
      tempKey,
      "",
      cwd,
      node.toolNames ?? "all",
      "scheduled",
    );
    sessionId = realSessionId;

    if (node.provider && node.modelId) {
      await session.send({ type: "set_model", provider: node.provider, modelId: node.modelId });
    }
    if (node.thinkingLevel) {
      await session.send({ type: "set_thinking_level", level: node.thinkingLevel });
    }

    const maxLifetimeMs = node.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS;
    const waiter = waitForAgentReply(session, runId, node.id, maxLifetimeMs);
    void session.send({ type: "prompt", message: prompt }).catch((err: unknown) => {
      waiter.fail(err instanceof Error ? err : new Error(String(err)));
    });
    const reply = await waiter.promise;
    log.info("workflow node success", {
      runId, nodeId: node.id, sessionId, durationMs: Date.now() - startedAt,
    });
    return { status: "success", reply, sessionId };
  } catch (err) {
    const errorStr = err instanceof Error ? err.message : String(err);
    log.warn("workflow node failed", { runId, nodeId: node.id, sessionId, error: errorStr });
    if (err instanceof MaxLifetimeExceededError) {
      return { status: "timeout", error: errorStr, sessionId };
    }
    if (err instanceof SessionInterruptedError) {
      return { status: "interrupted", error: errorStr, sessionId };
    }
    return { status: "error", error: errorStr, sessionId };
  }
}

// ── terminal-event waiter (mirrors scheduler/runner.ts) ─────────

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

type SessionWithDestroy = {
  onEvent: (cb: (event: AgentEvent) => void) => () => void;
  onDestroy: (cb: () => void) => () => void;
  destroy: () => void;
};

interface AgentReplyWaiter {
  promise: Promise<string>;
  fail: (err: Error) => void;
}

function waitForAgentReply(
  session: SessionWithDestroy,
  runId: string,
  nodeId: string,
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
    log.warn("agent session destroyed before agent_end", { runId, nodeId });
    fail(new SessionInterruptedError());
  };

  lifetimeTimer = setTimeout(() => {
    log.warn("max lifetime reached, destroying wrapper", { runId, nodeId, maxLifetimeMs });
    destroyingForTimeout = true;
    try {
      session.destroy();
    } catch (err) {
      log.warn("destroy failed during lifetime cap", { runId, nodeId, error: String(err) });
    }
    finish(new MaxLifetimeExceededError(maxLifetimeMs), "");
  }, maxLifetimeMs);

  unsubscribe = session.onEvent((event: AgentEvent) => {
    if (event.type === "prompt_failed") {
      const message = typeof event.error === "string" && event.error ? event.error : "prompt failed";
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
      log.warn("agent_end without messages snapshot", { runId, nodeId });
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