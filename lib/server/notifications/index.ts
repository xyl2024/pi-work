import { getChannel } from "./channel";
import "./channels/wechat";
import { createLogger } from "@/lib/server/logger";
import type {
  NotificationPayload,
  TaskNotification,
  TaskRunOutcome,
} from "@/lib/shared/notifications";

const log = createLogger("notify");

export function shouldNotify(
  notification: TaskNotification | null | undefined,
  outcome: TaskRunOutcome,
): boolean {
  if (!notification) return false;
  if (outcome === "success" && !notification.onSuccess) return false;
  if (outcome === "error" && !notification.onError) return false;
  if (outcome === "timeout" && !notification.onTimeout) return false;
  if (Array.isArray(notification.channels) && notification.channels.length === 0) return false;
  return true;
}

export function sanitizeNotification(raw: unknown): TaskNotification | null {
  if (raw === null || raw === undefined) return null;

  let input: TaskNotification;
  if (typeof raw === "string") {
    try {
      input = JSON.parse(raw) as TaskNotification;
    } catch {
      throw new Error("notification must be valid JSON");
    }
  } else if (typeof raw === "object") {
    input = raw as TaskNotification;
  } else {
    throw new Error("notification must be an object");
  }

  const channels = Array.isArray(input.channels) ? input.channels : [];
  const seen = new Set<string>();
  const normalizedChannels: TaskNotification["channels"] = [];
  for (const c of channels) {
    if (!c || typeof c.type !== "string" || !c.type) {
      throw new Error("Each notification channel needs a type");
    }
    const channel = getChannel(c.type);
    if (!channel) {
      throw new Error(`Unknown notification channel: ${c.type}`);
    }
    const validated = channel.validate(c);
    const dedupeKey = `${validated.type}:${validated.recipientId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalizedChannels.push(validated);
  }

  return {
    onSuccess: !!input.onSuccess,
    onError: !!input.onError,
    onTimeout: !!input.onTimeout,
    channels: normalizedChannels,
  };
}

export async function notify(
  notification: TaskNotification,
  payload: NotificationPayload,
): Promise<number> {
  const outcome: TaskRunOutcome = payload.outcome;
  let sent = 0;
  for (const cfg of notification.channels ?? []) {
    const channel = getChannel(cfg.type);
    if (!channel) continue;
    try {
      await channel.send(cfg, payload);
      sent += 1;
    } catch (err) {
      log.warn("notification channel failed", {
        type: cfg.type,
        taskId: payload.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (sent > 0) {
    log.info("notifications sent", { taskId: payload.taskId, outcome, sent });
  }
  return sent;
}
