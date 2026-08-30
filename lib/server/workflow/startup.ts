/**
 * Process-startup hook for the workflow engine.
 *
 * Called from `instrumentation.ts` (like the scheduler's) so the trigger loop
 * boots as soon as the server is ready. Idempotent — safe on HMR reloads.
 */

import { ensureWorkflowLoop } from "./trigger";
import { getRpcSession } from "@/lib/server/rpc-manager";
import {
  listRunningWorkflowRuns,
  listRunNodes,
  setRunNodeStatus,
  updateWorkflowRun,
} from "./store";
import { createLogger } from "../logger";

const log = createLogger("workflow/startup");

let bootstrapped = false;

/**
 * A previous process died mid-run: its in-flight workflow run and any
 * running node can never deliver agent_end. Mark the run interrupted and
 * skip/flag the running node. Runs whose wrapper is still alive (kept as
 * running across dev HMR) are preserved.
 */
function reconcileInterruptedRuns(): void {
  const runs = listRunningWorkflowRuns();
  let interrupted = 0;
  for (const r of runs) {
    const nodes = listRunNodes(r.runId);
    const runningNode = nodes.find((n) => n.status === "running");
    const live = runningNode?.sessionId != null && getRpcSession(runningNode.sessionId)?.isAlive() === true;

    if (live) continue;

    const reason = runningNode?.sessionId
      ? "workflow session was not alive after server startup before agent_end"
      : "server restarted before the workflow node session was created";
    try {
      if (runningNode) {
        setRunNodeStatus(runningNode.id, { status: "interrupted", error: reason });
        for (const n of nodes) {
          if (n.status === "pending") setRunNodeStatus(n.id, { status: "skipped", error: "server restarted mid-run" });
        }
      }
      updateWorkflowRun(r.runId, { status: "interrupted", error: reason });
      interrupted++;
    } catch (error) {
      log.error("failed to reconcile interrupted workflow run", {
        runId: r.runId,
        error: String(error),
      });
    }
  }
  if (interrupted > 0) {
    log.warn("reconciled interrupted workflow runs", { count: interrupted });
  }
}

export function bootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  log.info("workflow bootstrap");
  reconcileInterruptedRuns();
  ensureWorkflowLoop();
}
