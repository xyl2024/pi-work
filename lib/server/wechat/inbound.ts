/**
 * Channel-scoped inbound WeChat message handler.
 *
 * This is the heart of a WeChat channel: given an inbound message it
 * reuses (or cold-starts) the channel's agent session, runs the prompt,
 * and replies with the agent's final text.
 *
 * The turn itself (acquire the session → deliver the prompt → wait until it has
 * really finished → clean up) goes through the turn module (`lib/server/turn`,
 * via `runTurnRpcSession`); this file is the channel's adapter: it owns the
 * channel binding, the queue, the idempotency gate, the activity feed and the
 * reply. `agent_settled` is the terminal event, so a turn pi is still retrying
 * is not mistaken for a finished one, and a session destroyed mid-wait stops
 * waiting instead of hanging until the deadline.
 *
 * Isolation guarantees (multi-channel):
 *   - every access goes through the channel record / channel credentials;
 *     there is no global single-account state any more;
 *   - messages are serialized per `channelId` via
 *     `lib/server/serial-chain.ts:runSerial`;
 *   - idempotency: a message key (upstream message_id, else a hash of
 *     channel+user+time+text) is claimed before processing, so redeliveries
 *     never produce a duplicate reply, and a key whose handling failed is
 *     released so an upstream redelivery can be retried;
 *   - a reply is only sent while the channel is still `connected` — after
 *     disable/delete/expire the agent work may finish, but no reply goes out;
 *   - token rejection marks only this channel `expired`.
 *
 * Caller: `lib/server/channels/wechat-worker.ts` (per-channel poll loop).
 */
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

/**
 * A 5min safety net — even if the agent misbehaves we won't wait forever. The
 * deadline is this channel's policy, passed to the turn module: at the deadline
 * the module destroys the stuck session (the pre-seam path left it alive) and
 * the user gets a failure reply.
 */
const AGENT_END_TIMEOUT_MS = 5 * 60 * 1000;

export interface InboundMessage {
  channelId: string;
  fromUserId: string;
  text: string;
  contextToken?: string;
  /** Upstream message id, when available — used for idempotency. */
  messageId?: number | string;
  createTimeMs?: number;
}

/**
 * Main entry. Serially processes the message on the channel's FIFO chain
 * and resolves once the reply has been sent (or the message was safely
 * skipped). Never throws — errors are logged and surfaced best-effort.
 */
export async function handleInbound(msg: InboundMessage): Promise<void> {
  // Idempotency gate — dedupe across redeliveries *before* queueing, so a
  // replayed batch never doubles the queue.
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
    // Disabled/deleted/expired during queueing — drop, no reply.
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
    // Forgive the key so an upstream redelivery can be retried.
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

  // Workspace handling: no workspace → tell the user and skip the agent.
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

  // Captured for the run below: the onSession hook is a closure, so it cannot
  // rely on the narrowing of `channel.workspaceId` done above.
  const workspaceId = channel.workspaceId;
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
      // A cold start has always run with the full registry; a reuse turn leaves
      // the selection alone so a revived session keeps the set its sidecar
      // recorded (the pre-seam split between `coldStart` and `sendPrompt`).
      ...(coldStart ? { toolNames: "all" as const } : {}),
      source: "user",
      session: sessionId ? { kind: "reuse", sessionId } : { kind: "fresh" },
      timeoutMs: AGENT_END_TIMEOUT_MS,
      // Runs the moment the session is acquired — before any setup command and
      // before the prompt. The pre-seam path bound the channel after
      // dispatching the prompt (cold start) or after `sendPrompt` returned
      // (reuse), so this only moves the binding / activity event slightly
      // earlier within the same turn.
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
      // Surface the failure through the shared path below, keeping the wording
      // this channel has always shown its users ("处理失败：Error: …").
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
    // Surface to the user but keep the session binding — the user can
    // retry with a follow-up message.
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

/**
 * Whether the workspace path is a real directory inside an allowed root.
 * The channel keeps its connection either way — only the agent run pauses.
 */
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

/**
 * Send a reply only if the channel is still `connected`. After disable /
 * delete / expire the in-flight agent may finish, but nothing goes out —
 * the "no replies after state change" invariant.
 */
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
    // E4 detection: 401/expired → mark only this channel as expired.
    if (/401|expired|invalid|token/i.test(errStr)) {
      updateChannel(msg.channelId, { status: "expired" });
    }
  }
}