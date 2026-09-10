/**
 * Channel-scoped inbound WeChat message handler.
 *
 * This is the heart of a WeChat channel: given an inbound message it
 * reuses (or cold-starts) the channel's agent session, runs the prompt,
 * and replies with the agent's final text.
 *
 * Isolation guarantees (multi-channel):
 *   - every access goes through the channel record / channel credentials;
 *     there is no global single-account state any more;
 *   - messages are serialized per `channelId` via an in-memory FIFO chain;
 *   - idempotency: a message key (upstream message_id, else a hash of
 *     channel+user+time+text) is claimed before processing, so redeliveries
 *     never produce a duplicate reply;
 *   - a reply is only sent while the channel is still `connected` — after
 *     disable/delete/expire the agent work may finish, but no reply goes out;
 *   - token rejection marks only this channel `expired`.
 *
 * Caller: `lib/server/channels/wechat-worker.ts` (per-channel poll loop).
 */
import { existsSync, statSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { api } from "@/lib/server/wechat";
import { getRpcSession, startRpcSession } from "@/lib/server/rpc-manager";
import { resolveSessionPath } from "@/lib/server/session-reader";
import { logSessionEvent } from "./sessions-log";
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
import type { AgentEvent } from "@/lib/server/rpc-manager";
import type { WeChatAccount } from "@/lib/shared/wechat/types";

const log = createLogger("wechat/inbound");

/** A 5min safety net — even if the agent misbehaves we won't wait forever. */
const AGENT_END_TIMEOUT_MS = 5 * 60 * 1000;

/** Per-channel FIFO chain of in-flight handleInbound calls. */
const inboundChains = new Map<string, Promise<unknown>>();

interface TextBlock { type: "text"; text: string }
interface AssistantMsg {
  role: "assistant";
  content: Array<{ type: string; text?: string }>;
  stopReason?: string;
  errorMessage?: string;
}
type AgentMessage = AssistantMsg | { role: "user" | "toolResult"; [k: string]: unknown };

/**
 * Cold-start a fresh session in the given workspace, with all tools
 * enabled and the default model from settings.json.
 */
async function coldStart(workspaceId: string, firstMessage: string): Promise<string> {
  if (!existsSync(workspaceId)) {
    throw new Error(`Directory does not exist: ${workspaceId}`);
  }
  const tempKey = `__new__${Date.now()}`;
  const { session, realSessionId } = await startRpcSession(tempKey, "", workspaceId, "all");
  await session.send({ type: "prompt", message: firstMessage });
  return realSessionId;
}

/** Send a prompt to an existing session, starting it from disk if needed. */
async function sendPrompt(sessionId: string, message: string): Promise<void> {
  let session = getRpcSession(sessionId);
  if (!session?.isAlive()) {
    const filePath = await resolveSessionPath(sessionId);
    if (!filePath) throw new Error(`Session not found: ${sessionId}`);
    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
    ({ session } = await startRpcSession(sessionId, filePath, cwd));
  }
  await session.send({ type: "prompt", message });
}

async function waitForAgentReply(sessionId: string): Promise<string> {
  const session = getRpcSession(sessionId);
  if (!session?.isAlive()) {
    throw new Error(`Session not running: ${sessionId}`);
  }

  return new Promise<string>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      unsubscribe();
      reject(new Error(`agent_end timed out after ${AGENT_END_TIMEOUT_MS}ms`));
    }, AGENT_END_TIMEOUT_MS);

    const unsubscribe = session.onEvent((event: AgentEvent) => {
      logSessionEvent({
        kind: "agent_event",
        sessionId,
        fromUserId: "",
        eventType: event.type,
      });
      if (event.type !== "agent_end") return;
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();

      const error = typeof event.error === "string" ? event.error : null;
      if (error) {
        reject(new Error(error));
        return;
      }
      const messages = Array.isArray(event.messages) ? (event.messages as AgentMessage[]) : null;
      if (!messages) {
        reject(new Error("agent_end arrived without messages"));
        return;
      }

      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role !== "assistant") continue;
        if (m.stopReason === "error" || m.stopReason === "aborted") {
          reject(new Error(m.errorMessage || `assistant stopReason=${m.stopReason}`));
          return;
        }
        const text = m.content
          .filter((b): b is TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (text) {
          resolve(text);
          return;
        }
      }
      resolve("");
    });
  });
}

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

  const prev = inboundChains.get(msg.channelId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => handleInboundImpl(msg, messageKey));
  inboundChains.set(msg.channelId, next);
  return next;
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

  let sessionId: string | null = channel.currentSessionId ?? null;
  void fireTyping(account, msg);

  try {
    if (!sessionId) {
      sessionId = await coldStart(channel.workspaceId, msg.text);
      updateChannel(channelId, { currentSessionId: sessionId });
      pushActivity(channelId, { kind: "session_started", sessionId, fromUserId: msg.fromUserId, text: msg.text });
      logSessionEvent({
        kind: "cold_start",
        sessionId,
        cwd: channel.workspaceId,
        fromUserId: msg.fromUserId,
      });
    } else {
      logSessionEvent({
        kind: "send",
        sessionId,
        fromUserId: msg.fromUserId,
        text: msg.text,
      });
      await sendPrompt(sessionId, msg.text);
      pushActivity(channelId, { kind: "agent_sent", sessionId, fromUserId: msg.fromUserId, text: msg.text });
    }

    const replyText = await waitForAgentReply(sessionId);
    const durationMs = Date.now() - startedAt;
    pushActivity(channelId, { kind: "agent_done", sessionId: sessionId ?? undefined, durationMs, text: replyText || undefined });
    logSessionEvent({
      kind: "agent_end",
      sessionId,
      fromUserId: msg.fromUserId,
      durationMs,
      replyText,
    });
    await safeReplyIfActive(account, msg, replyText || "（agent 没有产生输出）");
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