/**
 * Notification dispatcher.
 *
 * Two entry points:
 *   - `sanitizeNotification(raw)`  — validate + normalize a whole task's
 *     notification config for persistence (used by the scheduler store).
 *   - `notify(task, outcome, payload)` — fan a run outcome out to every
 *     enabled channel configured on the task that cares about that outcome.
 *
 * Channels are self-registering (see `./channels/wechat`); importing the
 * notification index pulls them in via a side-effect import below.
 */
import { getChannel } from "./channel";
import "./channels/wechat";
import { createLogger } from "@/lib/server/logger";
import type {
  NotificationPayload,
  TaskNotification,
  TaskRunOutcome,
} from "@/lib/shared/notifications";

const log = createLogger("notify");

/** An outcome whose notification flag is on and that has ≥1 channel. */
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

/**
 * Validate + normalize a task's notification config. Returns null when the
 * input is null/undefined/empty (no notification configured). Throws a
 * human message when a channel is unregistered or its config is invalid.
 */
export function sanitizeNotification(raw: unknown): TaskNotification | null {
  if (raw === null || raw === undefined) return null;

  // Accept a plain object or a pre-parsed TaskNotification.
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
  // Dedupe by (type, recipientId) and preserve order.
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

/**
 * Fan a run outcome out to every enabled channel that cares. Each channel is
 * tried independently — one failing channel never blocks the others. Returns
 * the number of successful sends (for logging/runs telemetry).
 */
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
