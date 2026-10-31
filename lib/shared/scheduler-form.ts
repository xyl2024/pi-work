import { Cron } from "croner";
import type { SchedulerTaskForm, ScheduledTask } from "./scheduler";
import { DEFAULT_BACKGROUND_PERMISSION_MODE } from "./permission-mode";

export const MIN_MAX_LIFETIME_MS = 1_000;
export const MAX_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const RUNNER_DEFAULT_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

export const EMPTY_SCHEDULER_FORM: SchedulerTaskForm = {
  name: "",
  cron: "0 9 * * *",
  cronValid: true,
  cwd: "",
  prompt: "",
  provider: "",
  modelId: "",
  thinkingLevel: "",
  toolSelection: "all",
  permissionMode: DEFAULT_BACKGROUND_PERMISSION_MODE,
  maxLifetimeMinutes: "",
  timezone: "",
  notifyEnabled: false,
  notifySuccess: true,
  notifyError: true,
  notifyTimeout: true,
  channelType: "wechat",
  channelId: "",
  recipientId: "",
};

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function listTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    const zones = intl.supportedValuesOf?.("timeZone");
    if (zones && zones.length > 0) return zones;
  } catch {
  }
  return [browserTimezone(), "UTC"];
}

export function newSchedulerForm(cwd: string | null): SchedulerTaskForm {
  return { ...EMPTY_SCHEDULER_FORM, cwd: cwd ?? "", timezone: browserTimezone() };
}

export function schedulerFormFromTask(task: ScheduledTask): SchedulerTaskForm {
  const notification = task.notification;
  return {
    name: task.name,
    cron: task.cron,
    cronValid: isCronValid(task.cron),
    cwd: task.cwd,
    prompt: task.prompt,
    provider: task.provider ?? "",
    modelId: task.modelId ?? "",
    thinkingLevel: task.thinkingLevel && task.thinkingLevel !== "auto" ? task.thinkingLevel : "",
    toolSelection: task.toolNames === null ? "all" : task.toolNames,
    permissionMode: task.permissionMode,
    maxLifetimeMinutes: formatMaxLifetimeForForm(task.maxLifetimeMs),
    timezone: task.timezone || browserTimezone(),
    notifyEnabled: !!notification && notification.channels.length > 0,
    notifySuccess: notification?.onSuccess ?? true,
    notifyError: notification?.onError ?? true,
    notifyTimeout: notification?.onTimeout ?? true,
    channelType: notification?.channels[0]?.type ?? "wechat",
    channelId: notification?.channels[0]?.channelId ?? "",
    recipientId: notification?.channels[0]?.recipientId ?? "",
  };
}

export function isCronValid(cron: string): boolean {
  try {
    new Cron(cron);
    return true;
  } catch {
    return false;
  }
}

export function parseMaxLifetimeMinutes(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round(n * 60_000);
  if (ms < MIN_MAX_LIFETIME_MS) return null;
  if (ms > MAX_MAX_LIFETIME_MS) return null;
  return ms;
}

export function formatMaxLifetimeForForm(ms: number | null): string {
  if (ms === null) return "";
  return String(Math.round(ms / 60_000));
}
