/**
 * Scheduled-task notification config — shared wire format.
 *
 * Stored on the scheduled task as a JSON `notification` column:
 *
 *   {
 *     onSuccess: boolean,
 *     onError:   boolean,
 *     onTimeout: boolean,
 *     channels:  [{ type: "wechat", recipientId: "xxx@im.wechat" }]
 *   }
 *
 * `type` selects the delivery channel. Each channel carries its own config
 * fields (the WeChat channel just needs a recipient @im.wechat id). New
 * channels (email, webhook, …) add a type + their own fields here without
 * touching the scheduler row shape.
 */

/** A single configured delivery channel on a task. */
export interface TaskChannelConfig {
  /** Channel type, e.g. "wechat". Must match a registered channel. */
  type: string;
  /** Recipient for that channel (channel-specific). */
  recipientId: string;
  /** Concrete configured channel instance. Required for new tasks. */
  channelId?: string;
  /** Extra channel-specific settings (future-proofing). */
  [key: string]: unknown;
}

/** Full notification settings attached to a scheduled task. */
export interface TaskNotification {
  onSuccess: boolean;
  onError: boolean;
  onTimeout: boolean;
  channels: TaskChannelConfig[];
}

/** Which run outcomes should notify. */
export type TaskRunOutcome = "success" | "error" | "timeout";

/** Message payload handed to a channel for delivery. */
export interface NotificationPayload {
  taskId: string;
  taskName: string;
  outcome: TaskRunOutcome;
  /** Short human summary (reply snippet / error text). */
  text: string;
  /** Full reply or error detail, may be long. */
  detail: string;
  runId?: string;
}
