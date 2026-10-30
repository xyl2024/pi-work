import type { SubagentTaskStatus } from "./types";

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
