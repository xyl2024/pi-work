import type { ScheduledTask } from "./scheduler";
import type { TaskNotification } from "./notifications";
import { RUNNER_DEFAULT_MAX_LIFETIME_MS } from "./scheduler-form";

export type SchedulerDetailSection = "prompt" | "config";

export const SCHEDULER_DETAIL_SECTION_DEFAULT_OPEN: Record<SchedulerDetailSection, boolean> = {
  prompt: false,
  config: false,
};

export type SchedulerConfigRowId =
  | "provider"
  | "model"
  | "thinkingLevel"
  | "tools"
  | "cwd"
  | "maxLifetime"
  | "timezone"
  | "notifications";

export type SchedulerNotifyOutcome = "success" | "error" | "timeout";

export interface SchedulerNotifyChannel {
  type: string;
  name: string | null;
  recipientId: string;
  unavailable: boolean;
}

export type SchedulerConfigValue =
  | { kind: "missing" }
  | { kind: "code"; text: string }
  | { kind: "thinking"; level: string }
  | { kind: "tools"; names: string[] | null }
  | { kind: "lifetime"; text: string; isDefault: boolean }
  | { kind: "notifications"; outcomes: SchedulerNotifyOutcome[]; channels: SchedulerNotifyChannel[] };

export interface SchedulerConfigRow {
  id: SchedulerConfigRowId;
  labelKey: string;
  value: SchedulerConfigValue;
}

export interface ChannelMeta {
  name: string;
  status: string;
}

export function formatSchedulerLifetime(ms: number | null): { text: string; isDefault: boolean } {
  const isDefault = ms === null || !Number.isFinite(ms);
  const totalMinutes = Math.round((isDefault ? RUNNER_DEFAULT_MAX_LIFETIME_MS : ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return { text: `${hours}h ${minutes}m`, isDefault };
  if (hours) return { text: `${hours}h`, isDefault };
  return { text: `${minutes}m`, isDefault };
}

function buildNotificationValue(
  notification: TaskNotification | null,
  channelMeta: Record<string, ChannelMeta> | null | undefined,
): Extract<SchedulerConfigValue, { kind: "notifications" }> {
  if (!notification) return { kind: "notifications", outcomes: [], channels: [] };
  const outcomes: SchedulerNotifyOutcome[] = [];
  if (notification.onSuccess) outcomes.push("success");
  if (notification.onError) outcomes.push("error");
  if (notification.onTimeout) outcomes.push("timeout");
  return {
    kind: "notifications",
    outcomes,
    channels: notification.channels.map((channel) => {
      const meta = channel.type === "wechat" && channel.channelId ? channelMeta?.[channel.channelId] : undefined;
      return {
        type: channel.type,
        name: meta?.name ?? null,
        recipientId: channel.recipientId,
        unavailable: channel.type === "wechat" && !!channel.channelId && !meta,
      };
    }),
  };
}

export function buildSchedulerConfigRows(
  task: ScheduledTask,
  channelMeta?: Record<string, ChannelMeta> | null,
): SchedulerConfigRow[] {
  const lifetime = formatSchedulerLifetime(task.maxLifetimeMs ?? null);
  return [
    {
      id: "provider",
      labelKey: "Provider",
      value: task.provider ? { kind: "code", text: task.provider } : { kind: "missing" },
    },
    {
      id: "model",
      labelKey: "Model",
      value: task.modelId ? { kind: "code", text: task.modelId } : { kind: "missing" },
    },
    {
      id: "thinkingLevel",
      labelKey: "Thinking level",
      value:
        task.thinkingLevel && task.thinkingLevel !== "auto"
          ? { kind: "thinking", level: task.thinkingLevel }
          : { kind: "missing" },
    },
    {
      id: "tools",
      labelKey: "Tools",
      value: { kind: "tools", names: task.toolNames ?? null },
    },
    {
      id: "cwd",
      labelKey: "Working directory",
      value: { kind: "code", text: task.cwd },
    },
    {
      id: "maxLifetime",
      labelKey: "Max lifetime",
      value: { kind: "lifetime", text: lifetime.text, isDefault: lifetime.isDefault },
    },
    {
      id: "timezone",
      labelKey: "Timezone",
      value: task.timezone ? { kind: "code", text: task.timezone } : { kind: "missing" },
    },
    {
      id: "notifications",
      labelKey: "Notifications",
      value: buildNotificationValue(task.notification, channelMeta),
    },
  ];
}
