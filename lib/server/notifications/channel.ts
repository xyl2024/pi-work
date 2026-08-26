/**
 * Notification channel interface + registry.
 *
 * A channel knows how to (a) validate/normalize its own config (used by the
 * scheduler store at save time) and (b) deliver a message to a recipient.
 * Register a channel once at module load with `registerChannel`, then the
 * dispatcher (`./index.ts`) drives all of them by `type`.
 *
 * Adding a new channel (email, webhook, …) = write a channel object + one
 * `registerChannel(...)` call. Nothing in the scheduler or dispatcher needs
 * to change.
 */
import type { NotificationPayload, TaskChannelConfig } from "@/lib/shared/notifications";

/** What a channel produces after validating+normalizing a config. */
export interface NotificationChannel {
  /** Stable id used in task config `type`. */
  readonly type: string;
  /**
   * Validate + normalize an incoming channel config. Return the sanitized
   * config to persist, or throw with a human message. Used by the scheduler
   * store before persisting a task.
   */
  validate(config: TaskChannelConfig): TaskChannelConfig;
  /**
   * Deliver a notification. Throw on hard failure (bad recipient, auth
   * error, …). Called only if `validate` already passed.
   */
  send(config: TaskChannelConfig, payload: NotificationPayload): Promise<void>;
}

const channels = new Map<string, NotificationChannel>();

/** Register a channel. Duplicate type → last one wins (dev-mode friendly). */
export function registerChannel(channel: NotificationChannel): void {
  channels.set(channel.type, channel);
}

/** Get a channel by type, or undefined when unregistered. */
export function getChannel(type: string): NotificationChannel | undefined {
  return channels.get(type);
}

/** All registered channel types (for UI listing / validation). */
export function listChannelTypes(): string[] {
  return Array.from(channels.keys());
}
