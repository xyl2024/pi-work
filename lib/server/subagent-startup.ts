import { createLogger } from "./logger";
import { hasSubagentStore, reconcileInterruptedSubagentTasks } from "./subagent-store";

const log = createLogger("subagent-startup");

declare global {
  var __piSubagentStartupReconciled: boolean | undefined;
}

export function reconcileLeftoverSubagentTasksOnce(): number {
  if (globalThis.__piSubagentStartupReconciled) return 0;
  globalThis.__piSubagentStartupReconciled = true;
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
