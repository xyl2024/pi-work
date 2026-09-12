/**
 * Process-startup hook for the Kanban board.
 *
 * On server boot, reconcile any "zombie" in_progress cards left by a previous
 * process (a wrapper is gone and could never have delivered agent_end) and
 * move them to review_test so they don't sit there forever. Mirrors
 * scheduler/startup.ts. Idempotent — safe to call multiple times.
 */

import { reconcileStaleTasks } from "./store";
import { createLogger } from "../logger";

const log = createLogger("kanban/startup");

let bootstrapped = false;

export function bootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  const { count } = reconcileStaleTasks(Date.now(), true);
  if (count > 0) {
    log.warn("reconciled stale kanban in_progress cards", { count });
  }
}