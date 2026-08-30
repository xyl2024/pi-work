/**
 * Workflow engine.
 *
 * Given a workflow run, executes its nodes in dependency order. Phase 1
 * handles linear chains (`depends_on` is set to the previous node at save
 * time); the engine walks nodes in `position` order and feeds each node the
 * rendered prompt built from upstream replies.
 *
 * Failure handling per node (after `maxAttempts` retries):
 *   - failurePolicy "fail" → abort the whole run (remaining nodes skipped).
 *   - failurePolicy "skip" → mark only this node skipped and continue.
 * A session interruption (server restart killed the wrapper mid-step) marks
 * the run interrupted.
 *
 * Cron/manual scheduling lives in trigger.ts; this module only executes a
 * run that has already been created in the store.
 */

import { executeAgentNode, type NodeRunOutcome } from "./executor";
import { NODE_DEFS, computeNodeOutputs, primaryOutputKey } from "@/lib/shared/workflow-nodes";
import { renderPrompt } from "./render";
import {
  createWorkflowRun,
  getWorkflow,
  getWorkflowRun,
  incrementRunNodeAttempts,
  listRunNodes,
  setRunNodeStatus,
  updateWorkflowRun,
} from "./store";
import type { WorkflowRunNode } from "@/lib/shared/workflow";
import { pushMessage } from "@/lib/server/inbox-store";
import { notify, shouldNotify } from "@/lib/server/notifications";
import type { Workflow, WorkflowNode, WorkflowRun } from "@/lib/shared/workflow";
import { createLogger } from "../logger";

const log = createLogger("workflow/engine");

/** Per-workflow FIFO chain so the same workflow never runs twice at once. */
const workflowChains = new Map<string, Promise<void>>();

export function isWorkflowRunning(workflowId: string): boolean {
  return workflowChains.has(workflowId);
}

export function runWorkflow(workflowId: string, trigger: "manual" | "cron", triggerInput: Record<string, string> | null): Promise<WorkflowRun> {
  const run = createWorkflowRun(workflowId, trigger, triggerInput);
  const prev = workflowChains.get(workflowId) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(() => executeWorkflowRun(run.id).catch((err) => {
      // Last-resort safety: never leave a run stuck in "running".
      log.error("unhandled workflow run failure", { runId: run.id, error: String(err) });
      try {
        updateWorkflowRun(run.id, { status: "failed", error: String(err) });
      } catch { /* ignore */ }
      return undefined;
    }));
  workflowChains.set(workflowId, next);
  return Promise.resolve(getWorkflowRun(run.id)!);
}

async function executeWorkflowRun(runId: string): Promise<void> {
  const run = getWorkflowRun(runId);
  if (!run) return;
  const workflow = getWorkflow(run.workflowId);
  if (!workflow) {
    updateWorkflowRun(runId, { status: "failed", error: "workflow deleted mid-run" });
    return;
  }

  const nodes = topoSortNodes(workflow.nodes);
  const runNodes = listRunNodes(runId);
  const runNodeByNodeId = new Map<string, WorkflowRunNode>();
  for (const rn of runNodes) runNodeByNodeId.set(rn.nodeId, rn);

  // Successful upstream replies → template context.
  const steps: Record<string, string> = {};
  const finalReplies: string[] = [];
  // Structured per-node outputs (nodeId → { outputKey: value }) used to resolve
  // data-input refs wired by the visual editor (node.inputs → upstream outputs).
  const values = new Map<string, Record<string, unknown>>();

  const state: { status: WorkflowRun["status"]; error: string | null } = {
    status: "success",
    error: null,
  };

  for (const node of nodes) {
    const runNode = runNodeByNodeId.get(node.id);
    if (!runNode) continue;

    // If an earlier node hard-failed, every later node is skipped.
    if (state.status === "failed") {
      setRunNodeStatus(runNode.id, { status: "skipped", error: "workflow failed before this node" });
      continue;
    }

    if (node.kind !== "agent") {
      // Pure function node: resolve data inputs, compute outputs, follow the
      // same failure-policy semantics as agent nodes.
      const resolved = resolveNodeInputs(node, values, run.triggerInput ?? {});
      setRunNodeStatus(runNode.id, {
        status: "running",
        renderInput: JSON.stringify({ params: node.params, inputs: resolved }),
        startedAt: Date.now(),
        sessionId: null,
      });

      let result: { outputs: Record<string, unknown>; error?: string };
      try {
        result = computeNodeOutputs(node.kind, node.params, resolved);
      } catch (err) {
        result = { outputs: {}, error: String(err) };
      }

      if (result.error) {
        setRunNodeStatus(runNode.id, { status: "failed", error: result.error, endedAt: Date.now() });
        if (node.failurePolicy === "skip") {
          setRunNodeStatus(runNode.id, { status: "skipped", error: result.error });
          continue;
        }
        state.status = "failed";
        state.error = result.error;
        break;
      }

      const primary = primaryOutputKey(node.kind);
      const replyVal = result.outputs[primary];
      const reply = typeof replyVal === "string" ? replyVal : JSON.stringify(replyVal ?? null);
      setRunNodeStatus(runNode.id, { status: "success", replyText: reply, endedAt: Date.now() });
      values.set(node.id, result.outputs);
      steps[node.id] = reply;
      finalReplies.push(reply);
      continue;
    }

    // Agent node: cold-start a session per the existing path.
    const prompt = renderPrompt(node.prompt, { steps, triggerInput: run.triggerInput ?? {} });
    const outcome = await executeNodeWithRetries(runId, runNode, node, workflow, run, prompt);

    if (outcome.type === "success") {
      const reply = outcome.reply ?? "";
      values.set(node.id, { reply });
      steps[node.id] = reply;
      finalReplies.push(reply);
      continue;
    }

    // Node did not succeed.
    if (outcome.type === "interrupted") {
      state.status = "interrupted";
      state.error = outcome.error;
      break;
    }
    if (node.failurePolicy === "skip") {
      setRunNodeStatus(runNode.id, { status: "skipped", error: outcome.error });
      continue;
    }
    // hard-fail
    state.status = "failed";
    state.error = outcome.error;
    break;
  }

  // Mark any still-pending (never reached) nodes as skipped.
  for (const node of nodes) {
    const rn = runNodeByNodeId.get(node.id);
    if (rn && (rn.status === "pending")) {
      setRunNodeStatus(rn.id, { status: "skipped", error: "workflow finished before this node" });
    }
  }

  const replyText = finalReplies.length > 0 ? String(finalReplies[finalReplies.length - 1]) : null;
  updateWorkflowRun(runId, { status: state.status, error: state.error, replyText });

  // ── Notify + inbox ───────────────────────────────────────────
  const isOk = state.status === "success";
  const detail = state.error ?? (replyText ? replyText.slice(0, 500) : "Workflow completed");
  const text = isOk
    ? (replyText ? replyText.slice(0, 120) : `Workflow ${workflow.name} completed`)
    : `${state.status}: ${state.error ?? "unknown"}`;

  safePush(workflow.id, {
    source: "workflow",
    level: isOk ? "info" : "error",
    title: workflow.name,
    payload: { body: detail.slice(0, 200) },
  });

  const outcome: "success" | "error" = isOk ? "success" : "error";
  if (shouldNotify(workflow.notification, outcome)) {
    void notify(workflow.notification!, {
      taskId: workflow.id,
      taskName: workflow.name,
      outcome,
      text,
      detail,
      runId,
    }).catch((err) => {
      log.warn("notification dispatch failed", { runId, error: String(err) });
    });
  }
}

/** Resolve a node's data inputs to concrete values.
 *
 *  Each declared input either carries a ref `"<nodeId>.<outputKey>"` pointing
 *  at an upstream node's computed output, or falls back to the literal value
 *  in `params[key]`. A `start` node additionally exposes the trigger input. */
function resolveNodeInputs(
  node: WorkflowNode,
  values: Map<string, Record<string, unknown>>,
  triggerInput: Record<string, string>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  if (node.kind === "start") {
    resolved["input"] = triggerInput ?? {};
  }

  const def = NODE_DEFS[node.kind];
  if (!def) return resolved;
  const bound = new Map<string, string | null>();
  for (const i of node.inputs ?? []) bound.set(i.key, i.ref ?? null);

  for (const inputDef of def.inputs) {
    const ref = bound.get(inputDef.key);
    if (ref) {
      const m = /^([\w-]+)\.([\w-]+)$/.exec(ref);
      if (m) {
        const [, nodeId, outKey] = m;
        const upstream = values.get(nodeId);
        if (upstream && Object.prototype.hasOwnProperty.call(upstream, outKey)) {
          resolved[inputDef.key] = upstream[outKey];
          continue;
        }
      }
    }
    resolved[inputDef.key] = (node.params ?? {})[inputDef.key];
  }
  return resolved;
}

/** Deterministic topological order: every dependency runs before its
 *  dependents (ties broken by the stored `position`). A cycle is impossible
 *  because the store rejects it at save time, but the guard keeps this safe
 *  even against hand-edited rows. */
function topoSortNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order = [...nodes].sort((a, b) => a.position - b.position);
  const result: WorkflowNode[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (node: WorkflowNode): void => {
    if (done.has(node.id)) return;
    if (visiting.has(node.id)) return; // cycle guard
    visiting.add(node.id);
    for (const depId of node.dependsOn) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }
    visiting.delete(node.id);
    done.add(node.id);
    result.push(node);
  };
  for (const n of order) visit(n);
  return result;
}

interface NodeOutcomeMarker {
  type: "success" | "failed" | "timeout" | "interrupted";
  reply?: string;
  error: string;
}

async function executeNodeWithRetries(
  runId: string,
  runNode: WorkflowRunNode,
  node: WorkflowNode,
  workflow: Workflow,
  run: WorkflowRun,
  prompt: string,
): Promise<NodeOutcomeMarker> {
  let attempts = 0;
  let last: NodeRunOutcome;

  // First attempt uses the pre-created run node; retries reuse the same row.
  do {
    attempts += 1;
    // Set running the first time (before any attempt breaks it); for retries
    // this re-opens the node after a failure was recorded.
    const t0 = Date.now();
    setRunNodeStatus(runNode.id, {
      status: "running",
      renderInput: prompt,
      startedAt: t0,
      sessionId: null,
    });
    const attemptCount = incrementRunNodeAttempts(runNode.id).attempts;

    const cwd = node.cwd ?? workflow.cwd;
    last = await executeAgentNode({
      tempKey: `__wf__${runId}__${runNode.id}`,
      cwd,
      prompt,
      node,
      runId,
    });

    if (last.status === "success") {
      setRunNodeStatus(runNode.id, {
        status: "success",
        replyText: last.reply,
        sessionId: last.sessionId,
        endedAt: Date.now(),
      });
      return { type: "success", reply: last.reply, error: "" };
    }

    // Failure — record it on the row and decide whether to retry.
    const err = last.error;
    setRunNodeStatus(runNode.id, {
      status: last.status === "interrupted" ? "interrupted" : "failed",
      error: err,
      sessionId: last.sessionId,
      endedAt: Date.now(),
    });

    if (last.status === "interrupted") {
      return { type: "interrupted", error: err };
    }
    // A timeout is treated as a retryable failure up to maxAttempts.
    if (attemptCount >= Math.max(1, node.maxAttempts)) {
      return { type: last.status === "timeout" ? "timeout" : "failed", error: err };
    }
    log.info("retrying workflow node", { runId, nodeId: node.id, attempt: attemptCount, max: node.maxAttempts });
    // Brief backoff before retry.
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * (attemptCount - 1), 5000)));
  } while (attempts < Math.max(1, node.maxAttempts));

  return last.status === "timeout" ? { type: "timeout", error: last.error } : { type: "failed", error: last.error };
}

function safePush(workflowId: string, input: Parameters<typeof pushMessage>[0]): void {
  try {
    pushMessage(input);
  } catch (err) {
    log.warn("inbox push failed", { workflowId, error: String(err) });
  }
}