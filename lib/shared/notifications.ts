export interface TaskChannelConfig {
  type: string;
  recipientId: string;
  channelId?: string;
  [key: string]: unknown;
}

export interface TaskNotification {
  onSuccess: boolean;
  onError: boolean;
  onTimeout: boolean;
  channels: TaskChannelConfig[];
}

export type TaskRunOutcome = "success" | "error" | "timeout";

export interface NotificationPayload {
  taskId: string;
  taskName: string;
  outcome: TaskRunOutcome;
  text: string;
  detail: string;
  runId?: string;
}
