import type { NotificationPayload, TaskChannelConfig } from "@/lib/shared/notifications";

export interface NotificationChannel {
  readonly type: string;
  validate(config: TaskChannelConfig): TaskChannelConfig;
  send(config: TaskChannelConfig, payload: NotificationPayload): Promise<void>;
}

const channels = new Map<string, NotificationChannel>();

export function registerChannel(channel: NotificationChannel): void {
  channels.set(channel.type, channel);
}

export function getChannel(type: string): NotificationChannel | undefined {
  return channels.get(type);
}
