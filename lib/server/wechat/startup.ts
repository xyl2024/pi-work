import { tryBecomeMonitorHost } from "./monitor-lock";
import {
  createWeChatWorker,
  listChannels,
  registerWorker,
  startChannel,
} from "@/lib/server/channels";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("wechat/startup");

let bootstrapped = false;

export function bootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  if (!tryBecomeMonitorHost()) {
    log.debug("another process hosts the wechat workers; this process stays silent");
    return;
  }

  const channels = listChannels("wechat");
  for (const channel of channels) {
    registerWorker(channel.id, createWeChatWorker(channel.id));
    if (channel.status === "connected") startChannel(channel.id);
  }
  if (channels.length > 0) {
    log.info("channel workers ready", { count: channels.length, connected: channels.filter((c) => c.status === "connected").length });
  }
}