/**
 * WeChat notification channel.
 *
 * Delivers a task notification as a WeChat message via the iLink bot CGI
 * (`api.sendTextMessage`). Requires a logged-in account (persisted in
 * `~/.pi-work/wechat/account.json`) and a recipient `@im.wechat` id.
 *
 * Failure handling:
 *   - No account configured (never logged in) → throw so the caller can log
 *     and, where appropriate, tell the user to log in.
 *   - Token expired (401 upstream) → mark the account expired so the WeChat
 *     panel shows a re-scan banner; still throw.
 */
import { state, api } from "@/lib/server/wechat";
import { registerChannel, type NotificationChannel } from "../channel";
import { createLogger } from "@/lib/server/logger";
import type { NotificationPayload, TaskChannelConfig } from "@/lib/shared/notifications";

const log = createLogger("notify/wechat");

const wechatChannel: NotificationChannel = {
  type: "wechat",

  validate(config: TaskChannelConfig): TaskChannelConfig {
    const recipientId = typeof config.recipientId === "string" ? config.recipientId.trim() : "";
    if (!recipientId) throw new Error("WeChat recipient is required");
    if (!recipientId.endsWith("@im.wechat")) {
      throw new Error("WeChat recipient must be a user id ending with @im.wechat");
    }
    return { ...config, recipientId };
  },

  async send(config: TaskChannelConfig, payload: NotificationPayload): Promise<void> {
    const account = state.loadAccount();
    if (!account) {
      const msg = "No WeChat account configured. Please scan to log in to WeChat first.";
      log.warn(msg, { taskId: payload.taskId });
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
        // iLink may mark the token as expired via a specific ret code; be
        // conservative and only surface the business error.
        const message = resp.errmsg || `WeChat send failed (ret=${resp.ret})`;
        if (resp.ret === 401 || /expired|invalid.*token/i.test(message)) {
          state.markAccountExpired();
        }
        throw new Error(message);
      }
      log.info("wechat notification sent", { taskId: payload.taskId, recipientId: config.recipientId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/expired|invalid.*token|401/i.test(message)) state.markAccountExpired();
      throw err;
    }
  },
};

registerChannel(wechatChannel);
