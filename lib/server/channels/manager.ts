import { createLogger } from "@/lib/server/logger";
import { getChannel, updateChannel } from "./db";

const log = createLogger("channels/manager");

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

export function isRunning(channelId: string): boolean {
  return workers.get(channelId)?.isRunning() ?? false;
}