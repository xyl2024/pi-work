/**
 * Process-startup hook for WeChat channels.
 *
 * Scans the channel DB once per server boot and registers a worker for
 * every existing channel, starting only those in the `connected` state.
 * Channels in `pending` / `disabled` / `expired` stay idle — they become
 * active via the login or enable APIs.
 *
 * The single-instance lock from `monitor-lock.ts` guards against several
 * pi-work processes (e.g. `next start` + `next dev`) duplicating the
 * pollers: only the lock holder registers workers. This is the same
 * cross-process guarantee the legacy single-account monitor relied on,
 * now applied to the whole channel set.
 */
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