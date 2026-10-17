/**
 * Form state helpers for the scheduler panel's task form.
 *
 * Pure — no React / DOM / server imports — so the "new task default" and the
 * "edit an existing task" mapping live in one place and the form page stays a
 * rendering shell. The dirty test itself lives in `lib/shared/scheduler-close.ts`
 * next to the close guard it feeds; this module only builds the two snapshots
 * that test compares.
 */

import { Cron } from "croner";
import type { SchedulerTaskForm, ScheduledTask } from "./scheduler";

/** Server-side bounds for `maxLifetimeMs`, kept in sync with the store. */
export const MIN_MAX_LIFETIME_MS = 1_000;
export const MAX_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** The runner's global default when a task has no explicit cap (2h). */
export const RUNNER_DEFAULT_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

/** A blank form, sitting on the default daily-at-09:00 schedule. */
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
  maxLifetimeMinutes: "",
  notifyEnabled: false,
  notifySuccess: true,
  notifyError: true,
  notifyTimeout: true,
  channelType: "wechat",
  channelId: "",
  recipientId: "",
};

/** A fresh form for a new task, defaulting the working directory to the cwd. */
export function newSchedulerForm(cwd: string | null): SchedulerTaskForm {
  return { ...EMPTY_SCHEDULER_FORM, cwd: cwd ?? "" };
}

/** Map an existing task onto the form for editing. */
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
    // Old tasks that stored thinkingLevel="auto" or null have to be re-picked
    // on next edit — "auto" is no longer offered in the dropdown.
    thinkingLevel: task.thinkingLevel && task.thinkingLevel !== "auto" ? task.thinkingLevel : "",
    toolSelection: task.toolNames === null ? "all" : task.toolNames,
    maxLifetimeMinutes: formatMaxLifetimeForForm(task.maxLifetimeMs),
    notifyEnabled: !!notification && notification.channels.length > 0,
    notifySuccess: notification?.onSuccess ?? true,
    notifyError: notification?.onError ?? true,
    notifyTimeout: notification?.onTimeout ?? true,
    channelType: notification?.channels[0]?.type ?? "wechat",
    channelId: notification?.channels[0]?.channelId ?? "",
    recipientId: notification?.channels[0]?.recipientId ?? "",
  };
}

/** True when croner can parse the expression. */
export function isCronValid(cron: string): boolean {
  try {
    new Cron(cron);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert the form's minutes-string to ms. Returns null for empty / invalid
 * input (which means "use the runner default").
 */
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

/** Format ms max lifetime for the form (as minutes, or empty for the default). */
export function formatMaxLifetimeForForm(ms: number | null): string {
  if (ms === null) return "";
  return String(Math.round(ms / 60_000));
}
