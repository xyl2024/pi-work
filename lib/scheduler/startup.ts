/**
 * Process-startup hook for the scheduled-tasks scheduler.
 *
 * Mirrors `lib/wechat/startup.ts`: called from `instrumentation.ts` so the
 * loop boots as soon as the server is ready, regardless of whether any
 * page has been requested. Idempotent — safe to call multiple times.
 */

import { ensureLoop } from "./loop";
import { getRpcSession } from "@/lib/rpc-manager";
import { listRunningRuns, recordRunEnd } from "./store";
import { createLogger } from "../logger";

const log = createLogger("scheduler/startup");

let bootstrapped = false;

/**
 * Reconcile durable runs left behind by a previous server process. A live
 * wrapper is kept as running so this remains safe across Next.js HMR reloads;
 * a missing wrapper means the process that owned the run is gone and could not
 * have delivered agent_end.
 */
function reconcileInterruptedRuns(now: number): void {
  const runs = listRunningRuns();
  let interrupted = 0;
  for (const run of runs) {
    const live = run.sessionId !== null && getRpcSession(run.sessionId)?.isAlive() === true;
    if (live) continue;

    const reason = run.sessionId
      ? "scheduler session was not alive after server startup before agent_end"
      : "server restarted before the scheduled agent session was created";
    try {
      recordRunEnd(run.id, {
        status: "interrupted",
        error: reason,
        sessionId: run.sessionId,
        durationMs: Math.max(0, now - run.startedAt),
      });
      interrupted++;
    } catch (error) {
      log.error("failed to reconcile interrupted run", {
        runId: run.id,
        error: String(error),
      });
    }
  }
  if (interrupted > 0) {
    log.warn("reconciled interrupted scheduled runs", { count: interrupted });
  }
}

export function bootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  log.info("scheduler bootstrap");
  reconcileInterruptedRuns(Date.now());
  ensureLoop();
}