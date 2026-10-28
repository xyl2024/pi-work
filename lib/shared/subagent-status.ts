import type { SubagentTaskStatus } from "./types";

/**
 * One label key and one colour per subagent task status, shared by every UI
 * surface that renders a status (the sessions popover and the live card panel).
 * Two surfaces drifting apart — e.g. `creating` reading "Subagent running" in a
 * card but "Creating" in the list — is exactly the inconsistency the lifecycle
 * spec forbids, so the mapping lives in one place.
 *
 * The keys are English source strings fed through `useI18n`, not display text.
 */
export const SUBAGENT_STATUS_LABEL_KEYS: Record<SubagentTaskStatus, string> = {
  queued: "Queued",
  creating: "Creating",
  running: "Running",
  stopping: "Stopping",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

export const SUBAGENT_STATUS_COLORS: Record<SubagentTaskStatus, string> = {
  queued: "var(--text-dim)",
  creating: "#eab308",
  running: "#16a34a",
  stopping: "#eab308",
  completed: "#22c55e",
  failed: "#ef4444",
  cancelled: "var(--text-dim)",
  interrupted: "#f59e0b",
};
