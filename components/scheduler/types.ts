/**
 * Shared types and helpers for the scheduler UI.
 *
 * The store (`lib/scheduler-store.ts`) defines the authoritative shapes on
 * the server side, but importing it from client components pulls in
 * `croner` + `better-sqlite3` transitively. So we mirror the types here
 * and let the wire format (what `/api/scheduled-tasks` returns) be the
 * single source of truth at runtime. If a column gets renamed on the
 * server, the resulting TypeScript error here is the canary.
 */

export type TaskRunStatus = "running" | "success" | "error" | "timeout" | "interrupted";

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  cwd: string;
  prompt: string;
  enabled: boolean;
  provider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  /** `null` = use all tools, `[]` = no tools, partial = custom subset. */
  toolNames: string[] | null;
  /** Hard cap on a single run before the runner force-destroys the
   *  wrapper. `null` = use the runner's global default (currently 2h).
   *  The scheduler waits for the real `agent_end` otherwise — long
   *  tasks deserve the real result, not a 5-min blanket cutoff. */
  maxLifetimeMs: number | null;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastRunStatus: TaskRunStatus | null;
}

export interface TaskRun {
  id: string;
  taskId: string;
  startedAt: number;
  endedAt: number | null;
  status: TaskRunStatus;
  replyText: string | null;
  error: string | null;
  sessionId: string | null;
  durationMs: number | null;
}

/** Match `RecordRunEndInput` on the server. */
export interface TaskRunEndPayload {
  status: TaskRunStatus;
  replyText?: string | null;
  error?: string | null;
  sessionId?: string | null;
  durationMs?: number;
}

/** Match `CreateTaskInput` on the server. */
export interface TaskCreatePayload {
  name: string;
  cron: string;
  cwd: string;
  prompt: string;
  enabled?: boolean;
  provider?: string | null;
  modelId?: string | null;
  thinkingLevel?: string | null;
  toolNames?: string[] | null;
  maxLifetimeMs?: number | null;
}

/** Match `UpdateTaskInput` on the server. */
export interface TaskUpdatePayload {
  id: string;
  name?: string;
  cron?: string;
  cwd?: string;
  prompt?: string;
  enabled?: boolean;
  provider?: string | null;
  modelId?: string | null;
  thinkingLevel?: string | null;
  toolNames?: string[] | null;
  maxLifetimeMs?: number | null;
}

/**
 * View state for the detail pane. One task can be inspected across four
 * tabs without losing its identity — the modal keeps `{ taskId, tab }`
 * as the selection key and re-fetches the active tab's data on change.
 */
export type DetailTab = "overview" | "runs" | "prompt" | "config";

export interface ModelMeta {
  modelList: { id: string; name: string; provider: string }[];
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  defaultModel: { provider: string; modelId: string } | null;
  /** Custom-model icon map ("<provider>:<modelId>" → provider id), from /api/models. */
  modelIcons?: Record<string, string>;
}
