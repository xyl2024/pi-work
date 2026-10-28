/**
 * Server-start reconciliation for subagent tasks.
 *
 * A restarted process cannot confirm that the child turns of a previous process
 * are still running, so every leftover non-terminal row (`queued`, `creating`,
 * `running`, `stopping`) is reported as `interrupted`. Nothing is replayed: the
 * parent agent is not woken, the input is not re-sent, and the row keeps its
 * recorded error, partial output and task history so the user (or the parent)
 * can inspect it and explicitly continue the child session.
 *
 * Runs from `instrumentation.ts` before the server handles requests. It is
 * guarded per process: a second boot hook in the same process (Next.js dev
 * reloads, tests) must never mark tasks this process is currently running as
 * interrupted. The task manager uses the same guard, so the fallback
 * reconciliation it performs is idempotent within one process as well.
 */
import { createLogger } from "./logger";
import { hasSubagentStore, reconcileInterruptedSubagentTasks } from "./subagent-store";

const log = createLogger("subagent-startup");

declare global {
  var __piSubagentStartupReconciled: boolean | undefined;
}

/**
 * Reconcile leftover tasks at most once per process (idempotent at the store
 * level too). Returns how many rows this call changed.
 */
export function reconcileLeftoverSubagentTasksOnce(): number {
  if (globalThis.__piSubagentStartupReconciled) return 0;
  // Mark before touching disk: the guard is what protects live in-process
  // tasks from a reload, not the store state.
  globalThis.__piSubagentStartupReconciled = true;
  // No store on disk means no subagent has ever run here: do not create a
  // database just to reconcile nothing.
  if (!hasSubagentStore()) return 0;
  const reconciled = reconcileInterruptedSubagentTasks();
  if (reconciled > 0) {
    log.warn("marked leftover subagent tasks as interrupted", { count: reconciled });
  }
  return reconciled;
}

export function bootstrap(): void {
  reconcileLeftoverSubagentTasksOnce();
}
