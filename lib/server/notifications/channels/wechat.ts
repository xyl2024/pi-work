/**
 * WeChat notification channel (scheduled-task outbound).
 *
 * Delivers a task notification as a WeChat message via the iLink bot CGI
 * (`api.sendTextMessage`) using the credentials of a concrete channel
 * (`channelId`). Every task notification must pick a specific channel —
 * there is no global single-account fallback any more.
 *
 * Failure handling:
 *   - channel missing / not `connected` → throw (the scheduler records why);
 *   - token expired (401 upstream) → mark only this channel `expired` and
 *     throw.
 */
import { api } from "@/lib/server/wechat";
import { getChannel, updateChannel } from "@/lib/server/channels";
import { loadChannelAccount } from "@/lib/server/channels/credentials";
import { registerChannel, type NotificationChannel } from "../channel";
import { createLogger } from "@/lib/server/logger";
import type { NotificationPayload, TaskChannelConfig } from "@/lib/shared/notifications";

const log = createLogger("notify/wechat");

const wechatChannel: NotificationChannel = {
  type: "wechat",

  validate(config: TaskChannelConfig): TaskChannelConfig {
    const recipientId = typeof config.recipientId === "string" ? config.recipientId.trim() : "";
    const channelId = typeof config.channelId === "string" ? config.channelId.trim() : "";
    if (!channelId) throw new Error("WeChat channel is required");
    if (!recipientId) throw new Error("WeChat recipient is required");
    if (!recipientId.endsWith("@im.wechat")) {
      throw new Error("WeChat recipient must be a user id ending with @im.wechat");
    }
    if (!getChannel(channelId)) throw new Error("WeChat channel not found");
    return { ...config, channelId, recipientId };
  },

  async send(config: TaskChannelConfig, payload: NotificationPayload): Promise<void> {
    const channelId = typeof config.channelId === "string" ? config.channelId : "";
    const channel = channelId ? getChannel(channelId) : null;
    if (!channel) {
      throw new Error("WeChat channel not found — task skipped");
    }
    if (channel.status !== "connected") {
      throw new Error(`WeChat channel "${channel.name}" is ${channel.status} — task skipped`);
    }
    const account = loadChannelAccount(channelId);
    if (!account) {
      const msg = "No WeChat credentials for channel. Please re-scan to connect.";
      log.warn(msg, { channelId, taskId: payload.taskId });
      throw new Error(msg);
    }

    const text = [
      `【${payload.taskName}】`,
      "",
      payload.text,
      payload.detail ? `\n${payload.detail.slice(0, 500)}` : "",
    ].join("\n");

    const clientId = api.newClientId();
    try {
      const resp = await api.sendTextMessage({
        baseUrl: account.baseUrl,
        token: account.token,
        to: config.recipientId,
        text,
        clientId,
      });
      if (resp.ret !== undefined && resp.ret !== 0) {
        const message = resp.errmsg || `WeChat send failed (ret=${resp.ret})`;
        if (resp.ret === 401 || /expired|invalid.*token/i.test(message)) {
          updateChannelExpired(channelId, payload.taskId);
        }
        throw new Error(message);
      }
      log.info("wechat notification sent", { channelId, taskId: payload.taskId, recipientId: config.recipientId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/expired|invalid.*token|401/i.test(message)) updateChannelExpired(channelId, payload.taskId);
      throw err;
    }
  },
};

registerChannel(wechatChannel);

function updateChannelExpired(channelId: string, taskId: string): void {
  try {
    updateChannel(channelId, { status: "expired" });
    log.warn("wechat notification token rejected, channel marked expired", { channelId, taskId });
  } catch (err) {
    log.warn("failed to mark channel expired", { channelId, error: String(err) });
  }
}