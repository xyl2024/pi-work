import { existsSync, statSync } from "fs";
import { api } from "@/lib/server/wechat";
import { runTurnRpcSession } from "@/lib/server/rpc-manager";
import { runSerial } from "@/lib/server/serial-chain";
import { logSessionEvent } from "./sessions-log";
import { toInboundReply } from "./inbound-reply";
import { createLogger } from "@/lib/server/logger";
import { getChannel, updateChannel } from "@/lib/server/channels";
import { pushActivity } from "@/lib/server/channels/activity";
import { loadChannelAccount } from "@/lib/server/channels/credentials";
import {
  abandonMessage,
  buildMessageKey,
  claimMessage,
  markProcessed,
} from "@/lib/server/channels/messages";
import { isPathAllowed, getAllowedRoots } from "@/lib/server/file-access";
import type { WeChatAccount } from "@/lib/shared/wechat/types";

const log = createLogger("wechat/inbound");

const AGENT_END_TIMEOUT_MS = 5 * 60 * 1000;

export interface InboundMessage {
  channelId: string;
  fromUserId: string;
  text: string;
  contextToken?: string;
  messageId?: number | string;
  createTimeMs?: number;
}

export async function handleInbound(msg: InboundMessage): Promise<void> {
  const messageKey = buildMessageKey({
    channelId: msg.channelId,
    messageId: msg.messageId,
    userId: msg.fromUserId,
    createTimeMs: msg.createTimeMs,
    text: msg.text,
  });
  const claim = claimMessage(msg.channelId, messageKey);
  if (claim !== "accepted") return;

  return runSerial(msg.channelId, () => handleInboundImpl(msg, messageKey));
}

async function handleInboundImpl(msg: InboundMessage, messageKey: string): Promise<void> {
  const startedAt = Date.now();
  const { channelId } = msg;
  logSessionEvent({
    kind: "inbound",
    fromUserId: msg.fromUserId,
    text: msg.text,
    contextToken: msg.contextToken,
  });

  const channel = getChannel(channelId);
  if (!channel || channel.status !== "connected") {
    abandonMessage(channelId, messageKey);
    return;
  }
  const account = loadChannelAccount(channelId);
  if (!account) {
    log.warn("inbound dropped — channel has no credentials", { channelId, fromUserId: msg.fromUserId });
    abandonMessage(channelId, messageKey);
    return;
  }

  pushActivity(channelId, { kind: "message_received", fromUserId: msg.fromUserId, text: msg.text });

  try {
    await processMessage(channelId, account, msg, startedAt);
    markProcessed(channelId, messageKey);
  } catch (err) {
    abandonMessage(channelId, messageKey);
    const errorStr = err instanceof Error ? err.message : String(err);
    log.error("inbound failed", { channelId, fromUserId: msg.fromUserId, error: errorStr });
    logSessionEvent({
      kind: "agent_error",
      sessionId: "(block)",
      fromUserId: msg.fromUserId,
      error: errorStr,
    });
    await safeReplyIfActive(account, msg, `处理失败：${errorStr.slice(0, 200)}`);
  }
}

async function processMessage(
  channelId: string,
  account: WeChatAccount,
  msg: InboundMessage,
  startedAt: number,
): Promise<void> {
  const channel = getChannel(channelId);
  if (!channel || channel.status !== "connected") return;

  if (!channel.workspaceId) {
    log.warn("inbound dropped — channel has no workspace", { channelId, fromUserId: msg.fromUserId });
    pushActivity(channelId, { kind: "workspace_missing", fromUserId: msg.fromUserId });
    await safeReplyIfActive(account, msg, "当前未设置 workspace，请到 pi-work 频道面板里选一个。");
    return;
  }
  if (!workspaceUsable(channel.workspaceId)) {
    log.warn("inbound paused — workspace unusable", { channelId, workspaceId: channel.workspaceId });
    pushActivity(channelId, { kind: "workspace_unusable", fromUserId: msg.fromUserId, detail: channel.workspaceId });
    await safeReplyIfActive(account, msg, "当前 workspace 不可用，请在频道面板重新选择。");
    return;
  }

  const isNew = msg.text.trim() === "/new";
  if (isNew) {
    logSessionEvent({ kind: "command", fromUserId: msg.fromUserId, command: "/new" });
    updateChannel(channelId, { currentSessionId: null });
    pushActivity(channelId, { kind: "session_reset", fromUserId: msg.fromUserId });
    await safeReplyIfActive(account, msg, "已重置，下条消息开始新会话。");
    return;
  }

  const workspaceId = channel.workspaceId;
  const origin = {
    kind: "channel" as const,
    channelId: channel.id,
    provider: channel.provider,
    name: channel.name,
  };
  let sessionId: string | null = channel.currentSessionId ?? null;
  const coldStart = sessionId === null;
  void fireTyping(account, msg);

  try {
    if (sessionId) {
      logSessionEvent({
        kind: "send",
        sessionId,
        fromUserId: msg.fromUserId,
        text: msg.text,
      });
    }

    const result = await runTurnRpcSession({
      cwd: workspaceId,
      prompt: msg.text,
      ...(coldStart ? { toolNames: "all" as const } : {}),
      source: "user",
      purpose: "channel",
      origin,
      session: sessionId ? { kind: "reuse", sessionId } : { kind: "fresh" },
      timeoutMs: AGENT_END_TIMEOUT_MS,
      onSession: ({ realSessionId }) => {
        if (!coldStart) {
          pushActivity(channelId, {
            kind: "agent_sent",
            sessionId: realSessionId,
            fromUserId: msg.fromUserId,
            text: msg.text,
          });
          return;
        }
        sessionId = realSessionId;
        updateChannel(channelId, { currentSessionId: realSessionId });
        pushActivity(channelId, {
          kind: "session_started",
          sessionId: realSessionId,
          fromUserId: msg.fromUserId,
          text: msg.text,
        });
        logSessionEvent({
          kind: "cold_start",
          sessionId: realSessionId,
          cwd: workspaceId,
          fromUserId: msg.fromUserId,
        });
      },
    });

    const reply = toInboundReply(result, AGENT_END_TIMEOUT_MS);
    if (!reply.ok) {
      throw new Error(reply.error ?? `turn ${result.status}`);
    }

    const durationMs = Date.now() - startedAt;
    pushActivity(channelId, {
      kind: "agent_done",
      sessionId: result.realSessionId,
      durationMs,
      text: result.hasReply ? result.text : undefined,
    });
    logSessionEvent({
      kind: "agent_end",
      sessionId: result.realSessionId,
      fromUserId: msg.fromUserId,
      durationMs,
      replyText: result.text,
    });
    await safeReplyIfActive(account, msg, reply.text);
  } catch (err) {
    logSessionEvent({
      kind: "agent_error",
      sessionId: sessionId ?? "(none)",
      fromUserId: msg.fromUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    pushActivity(channelId, {
      kind: "agent_error",
      sessionId: sessionId ?? undefined,
      fromUserId: msg.fromUserId,
      detail: err instanceof Error ? err.message : String(err),
    });
    await safeReplyIfActive(account, msg, `处理失败：${String(err).slice(0, 200)}`);
  }
}

async function workspaceUsable(workspaceId: string): Promise<boolean> {
  if (!existsSync(workspaceId)) return false;
  try {
    if (!statSync(workspaceId).isDirectory()) return false;
    const roots = await getAllowedRoots();
    return isPathAllowed(workspaceId, roots);
  } catch {
    return false;
  }
}

async function fireTyping(account: { baseUrl: string; token: string }, msg: InboundMessage): Promise<void> {
  try {
    await api.sendTyping({ baseUrl: account.baseUrl, token: account.token, to: msg.fromUserId, contextToken: msg.contextToken });
  } catch (err) {
    log.debug("sendtyping failed (ignored)", { channelId: msg.channelId, to: msg.fromUserId, error: String(err) });
  }
}

async function safeReplyIfActive(
  account: { baseUrl: string; token: string },
  msg: InboundMessage,
  text: string,
): Promise<void> {
  const channel = getChannel(msg.channelId);
  if (!channel || channel.status !== "connected") return;
  try {
    await api.sendTextMessage({
      baseUrl: account.baseUrl,
      token: account.token,
      to: msg.fromUserId,
      text,
      contextToken: msg.contextToken,
      clientId: api.newClientId(),
    });
    pushActivity(msg.channelId, { kind: "reply", fromUserId: msg.fromUserId, text });
    logSessionEvent({
      kind: "reply",
      sessionId: "(reply)",
      fromUserId: msg.fromUserId,
      length: text.length,
    });
  } catch (err) {
    const errStr = err instanceof Error ? err.message : String(err);
    log.warn("reply failed", { channelId: msg.channelId, to: msg.fromUserId, error: errStr });
    logSessionEvent({
      kind: "reply_failed",
      sessionId: "(reply)",
      fromUserId: msg.fromUserId,
      error: errStr,
    });
    pushActivity(msg.channelId, {
      kind: "reply_failed",
      fromUserId: msg.fromUserId,
      detail: errStr,
    });
    if (/401|expired|invalid|token/i.test(errStr)) {
      updateChannel(msg.channelId, { status: "expired" });
    }
  }
}