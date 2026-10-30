import { api } from "@/lib/server/wechat";
import { getChannel, updateChannel } from "./db";
import { registerWorker, startChannel } from "./manager";
import { loadChannelAccount } from "./credentials";
import { handleInbound } from "@/lib/server/wechat/inbound";
import { clearChannelMessages, pruneMessages } from "./messages";
import { pushActivity } from "./activity";
import { clearWorkerHealth, updateWorkerHealth } from "./health";
import type { WeixinMessage } from "@/lib/shared/wechat/types";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("channels/wechat-worker");

const POLL_TIMEOUT_MS = 3_000;
const POLL_INTERVAL_MS = 1_000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 30_000;
const MAX_BACKOFF_STREAK = 8;
const PRUNE_EVERY_TICKS = 60;

interface WorkerRuntime {
  stopped: boolean;
  inFlight: boolean;
  timer?: ReturnType<typeof setTimeout>;
  controller?: AbortController;
  failures: number;
  notifiedStart: boolean;
  ticksSincePrune: number;
}

const workers = new Map<string, WorkerRuntime>();

function stopRuntime(runtime: WorkerRuntime): void {
  runtime.stopped = true;
  if (runtime.timer) clearTimeout(runtime.timer);
  runtime.controller?.abort();
}

export function ensureWeChatWorkerRunning(channelId: string): boolean {
  registerWorker(channelId, createWeChatWorker(channelId));
  return startChannel(channelId);
}

export function createWeChatWorker(channelId: string) {
  return {
    start() {
      const previous = workers.get(channelId);
      if (previous) {
        stopRuntime(previous);
      }
      const runtime: WorkerRuntime = {
        stopped: false,
        inFlight: false,
        failures: 0,
        notifiedStart: false,
        ticksSincePrune: 0,
      };
      workers.set(channelId, runtime);
      clearWorkerHealth(channelId);
      pushActivity(channelId, { kind: "worker_started" });
      void tick(channelId, runtime);
    },
    stop() {
      const runtime = workers.get(channelId);
      if (!runtime) return;
      stopRuntime(runtime);
      workers.delete(channelId);
      clearWorkerHealth(channelId);
      pushActivity(channelId, { kind: "worker_stopped" });
    },
    isRunning() {
      return workers.has(channelId);
    },
  };
}

function backoffDelay(runtime: WorkerRuntime): number {
  if (runtime.failures <= 0) return POLL_INTERVAL_MS;
  const attempts = Math.min(runtime.failures, MAX_BACKOFF_STREAK);
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS);
}

function isTokenError(message: string): boolean {
  return /401|expired|invalid.*token|unauthor/i.test(message);
}

async function tick(channelId: string, runtime: WorkerRuntime): Promise<void> {
  if (runtime.stopped || runtime.inFlight) return;

  const channel = getChannel(channelId);
  if (!channel || channel.status !== "connected") {
    stopRuntime(runtime);
    return;
  }
  const account = loadChannelAccount(channelId);
  if (!account) {
    log.warn("connected channel has no credentials, worker stops", { channelId });
    stopRuntime(runtime);
    return;
  }

  if (!runtime.notifiedStart) {
    runtime.notifiedStart = true;
    api
      .notifyStart({ baseUrl: account.baseUrl, token: account.token })
      .catch((err) => log.debug("notifyStart failed (ignored)", { channelId, error: String(err) }));
  }

  runtime.inFlight = true;
  const controller = new AbortController();
  runtime.controller = controller;
  try {
    const response = await api.getUpdates({
      baseUrl: account.baseUrl,
      token: account.token,
      getUpdatesBuf: channel.syncBuf,
      timeoutMs: POLL_TIMEOUT_MS,
      signal: controller.signal,
    });
    runtime.failures = 0;

    if (response.ret !== undefined && response.ret !== 0) {
      const message = response.errmsg || `ret=${response.ret}`;
      if (isTokenError(message) || response.ret === 401) {
        throw new Error(message);
      }
      log.warn("channel getUpdates non-zero ret", { channelId, ret: response.ret, errmsg: response.errmsg });
    }

    updateWorkerHealth(channelId, {
      lastPollAt: new Date().toISOString(),
      lastFailureAt: null,
      consecutiveFailures: 0,
      nextRetryAt: null,
    });

    if (response.get_updates_buf) {
      updateChannel(channelId, { syncBuf: response.get_updates_buf });
    }

    const msgs = response.msgs ?? [];
    if (msgs.length > 0) {
      log.info("channel received messages", { channelId, count: msgs.length });
      runtime.ticksSincePrune += 1;
      if (runtime.ticksSincePrune >= PRUNE_EVERY_TICKS) {
        runtime.ticksSincePrune = 0;
        try {
          pruneMessages();
        } catch (err) {
          log.debug("message prune failed (ignored)", { channelId, error: String(err) });
        }
      }
    }

    for (const message of msgs) {
      if (!message.from_user_id) continue;
      const text = extractPreview(message);
      if (!text) continue;
      await handleInbound({
        channelId,
        fromUserId: message.from_user_id,
        text,
        contextToken: message.context_token,
        messageId: message.message_id,
        createTimeMs: message.create_time_ms,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isTokenError(message)) {
      log.warn("channel token rejected, marking expired", { channelId, error: message });
      pushActivity(channelId, { kind: "token_expired", detail: message });
      try {
        updateChannel(channelId, { status: "expired" });
      } catch (err) {
        log.warn("failed to mark channel expired", { channelId, error: String(err) });
      }
      clearChannelMessages(channelId);
      updateWorkerHealth(channelId, { consecutiveFailures: 0, nextRetryAt: null });
      stopRuntime(runtime);
      return;
    }
    runtime.failures += 1;
    updateWorkerHealth(channelId, {
      consecutiveFailures: runtime.failures,
      lastFailureAt: new Date().toISOString(),
      nextRetryAt: new Date(Date.now() + backoffDelay(runtime)).toISOString(),
    });
    log.warn("channel poll failed", { channelId, error: message, failures: runtime.failures });
  } finally {
    runtime.inFlight = false;
    runtime.controller = undefined;
    if (!runtime.stopped) {
      runtime.timer = setTimeout(() => void tick(channelId, runtime), backoffDelay(runtime));
      if (typeof runtime.timer.unref === "function") runtime.timer.unref();
    }
  }
}

function extractPreview(msg: WeixinMessage): string {
  const items = msg.item_list ?? [];
  for (const item of items) {
    if (item.type === 1 && item.text_item?.text) {
      return String(item.text_item.text);
    }
  }
  return "";
}