/**
 * Scheduled-task shapes shared by the scheduler panel view.
 *
 * The server's authoritative record types live in
 * `lib/server/scheduler/store.ts`, but importing them from client code would
 * drag in `croner` + `better-sqlite3` transitively. These mirror the wire
 * format (what `/api/scheduled-tasks` returns) so both the panel's io layer and
 * its components read the same types without importing server code. If a
 * column is renamed on the server, the resulting TypeScript error here is the
 * canary.
 */

import type { TaskNotification } from "./notifications";
import type { ToolSelection } from "./types";

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
  /** IANA timezone used to interpret the cron expression. */
  timezone: string;
  /** Notification config (channels + which outcomes trigger). null = off. */
  notification: TaskNotification | null;
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
  timezone?: string;
  notification?: TaskNotification | null;
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
  timezone?: string;
  notification?: TaskNotification | null;
}

/** One task can be inspected across four blocks without losing its identity. */
export type SchedulerDetailBlock = "overview" | "runs" | "prompt" | "config";

/** The model catalog the form's selectors read from `/api/models`. */
export interface SchedulerModelMeta {
  modelList: { id: string; name: string; provider: string }[];
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  defaultModel: { provider: string; modelId: string } | null;
  /** Custom-model icon map ("<provider>:<modelId>" → provider id), from /api/models. */
  modelIcons?: Record<string, string>;
}

/**
 * The editable shape of the task form. Kept in the shared layer (not in the
 * store) so the close guard's dirty test and the form page can both name it,
 * and so the "new task" default is declared once.
 */
export interface SchedulerTaskForm {
  name: string;
  cron: string;
  cronValid: boolean;
  cwd: string;
  prompt: string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  toolSelection: ToolSelection;
  /** Max lifetime in minutes. Empty / 0 ⇒ use the runner's default (2h). */
  maxLifetimeMinutes: string;
  /** IANA timezone the cron expression is interpreted in. */
  timezone: string;
  notifyEnabled: boolean;
  notifySuccess: boolean;
  notifyError: boolean;
  notifyTimeout: boolean;
  channelType: string;
  channelId: string;
  recipientId: string;
}
