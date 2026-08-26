import { createLogger } from "@/lib/server/logger";
import { getChannel, listChannels, updateChannel } from "./db";

const log = createLogger("channels/manager");

/** Runtime registry for channel workers. Workers are intentionally injected so
 * provider-specific implementations do not leak into the generic channel DB. */
export interface ChannelWorker {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

const workers = new Map<string, ChannelWorker>();

export function registerWorker(channelId: string, worker: ChannelWorker): void {
  const previous = workers.get(channelId);
  if (previous && previous !== worker) previous.stop();
  workers.set(channelId, worker);
}

export function startChannel(channelId: string): boolean {
  const channel = getChannel(channelId);
  const worker = workers.get(channelId);
  if (!channel || !worker || channel.status !== "connected") return false;
  worker.start();
  log.info("channel worker started", { channelId });
  return true;
}

export function stopChannel(channelId: string): void {
  workers.get(channelId)?.stop();
  log.info("channel worker stopped", { channelId });
}

/**
 * Enable (status → connected + start worker) or disable (stop worker +
 * status → disabled) a channel.
 *
 * `pending` / `expired` channels cannot be enabled — both must go through
 * a (re)scan, and the disable path is always allowed. Enabling a disabled
 * channel whose worker was never registered (e.g. after a process restart)
 * is rejected; callers should `registerWorker` first — see
 * `ensureWeChatWorkerRunning` in `wechat-worker.ts`.
 */
export function setEnabled(channelId: string, enabled: boolean): boolean {
  const channel = getChannel(channelId);
  if (!channel) return false;
  if (enabled) {
    if (channel.status === "pending" || channel.status === "expired") return false;
    if (channel.status === "disabled" && !workers.has(channelId)) return false;
    updateChannel(channelId, { status: "connected" });
    return startChannel(channelId);
  }
  stopChannel(channelId);
  updateChannel(channelId, { status: "disabled" });
  return true;
}

/** Start workers for every currently `connected` channel (process boot). */
export function startAll(): void {
  for (const channel of listChannels("wechat")) {
    if (channel.status === "connected") startChannel(channel.id);
  }
}

/** Stop every registered worker (process shutdown / HMR teardown). */
export function stopAll(): void {
  for (const channelId of workers.keys()) stopChannel(channelId);
}

export function isRunning(channelId: string): boolean {
  return workers.get(channelId)?.isRunning() ?? false;
}