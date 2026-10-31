export type SchedulerPage =
  | { kind: "root" }
  | { kind: "detail"; taskId: string }
  | { kind: "form"; taskId: string | null };

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
  toolNames: string[] | null;
  maxLifetimeMs: number | null;
  timezone: string;
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

export interface TaskRunEndPayload {
  status: TaskRunStatus;
  replyText?: string | null;
  error?: string | null;
  sessionId?: string | null;
  durationMs?: number;
}

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

export type SchedulerDetailBlock = "overview" | "runs" | "prompt" | "config";

export interface SchedulerModelMeta {
  modelList: { id: string; name: string; provider: string }[];
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  defaultModel: { provider: string; modelId: string } | null;
  modelIcons?: Record<string, string>;
  modelIconPreferences?: Record<string, string>;
}

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
  maxLifetimeMinutes: string;
  timezone: string;
  notifyEnabled: boolean;
  notifySuccess: boolean;
  notifyError: boolean;
  notifyTimeout: boolean;
  channelType: string;
  channelId: string;
  recipientId: string;
}
