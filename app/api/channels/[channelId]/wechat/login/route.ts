/**
 * Channel-scoped WeChat QR login.
 *
 * POST /api/channels/:channelId/wechat/login
 *   Starts a QR login for the channel. Requires an existing channel in a
 *   scannable state (pending / connected / expired). One session per
 *   channel at a time — starting a new scan drops any previous session.
 *
 * GET /api/channels/:channelId/wechat/login?sessionKey=…
 *   Polls the login state machine. On `confirmed` the credentials are
 *   written to the channel credential dir and the channel transitions to
 *   `connected` with a fresh syncBuf and no current session (first inbound
 *   message cold-starts a new session).
 */
import { NextResponse } from "next/server";
import { api, qr } from "@/lib/server/wechat";
import {
  createSession,
  dropSessionsForChannel,
  getSession,
  updateSession,
} from "@/lib/server/wechat/login-sessions";
import type { LoginSession } from "@/lib/shared/wechat/types";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import {
  createWeChatWorker,
  getChannel,
  listChannels,
  registerWorker,
  startChannel,
  updateChannel,
} from "@/lib/server/channels";
import { clearChannelMessages } from "@/lib/server/channels/messages";
import { saveChannelAccount } from "@/lib/server/channels/credentials";

export const dynamic = "force-dynamic";

const log = createLogger("api/channels/wechat/login");

const DEFAULT_BOT_TYPE = "3";

type Params = { params: Promise<{ channelId: string }> };

export async function POST(_: Request, { params }: Params) {
  const startedAt = Date.now();
  const { channelId } = await params;
  const channel = getChannel(channelId);
  if (!channel) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (channel.status === "disabled") {
    return NextResponse.json({ error: "channel_disabled" }, { status: 409 });
  }
  try {
    const fetched = await api.fetchQrCode(DEFAULT_BOT_TYPE);
    if (!fetched.qrcode || !fetched.qrcode_img_content) {
      return NextResponse.json({ error: "failed_to_fetch_qr" }, { status: 502 });
    }

    // One active login session per channel.
    dropSessionsForChannel(channelId);
    const session = createSession({
      qrcodeUrl: fetched.qrcode_img_content,
      qrcode: fetched.qrcode,
      baseUrl: "https://ilinkai.weixin.qq.com",
      botType: DEFAULT_BOT_TYPE,
      channelId,
    });

    const qrDataUrl = await qr.toDataUrl(fetched.qrcode_img_content);

    log.info("qr session created", { channelId, sessionKey: session.sessionKey, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({
      sessionKey: session.sessionKey,
      qrDataUrl,
      qrUrl: fetched.qrcode_img_content,
      expiresAt: session.startedAt + 5 * 60 * 1000,
    });
  } catch (err) {
    log.error("start login failed", { channelId, error: String(err), durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: Request, { params }: Params) {
  const startedAt = Date.now();
  const { channelId } = await params;
  const url = new URL(req.url);
  const sessionKey = url.searchParams.get("sessionKey");
  if (!sessionKey) return NextResponse.json({ error: "sessionKey_required" }, { status: 400 });

  const session = getSession(sessionKey);
  if (!session || session.channelId !== channelId) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  let working = session;
  if (
    session.phase === "waiting" ||
    session.phase === "scanned" ||
    session.phase === "verifying" ||
    session.phase === "redirected" ||
    session.phase === "verify_blocked"
  ) {
    try {
      const status = await api.pollQrStatus(session.baseUrl, session.qrcode, session.pendingVerifyCode);
      if (session.pendingVerifyCode) {
        updateSession(sessionKey, { pendingVerifyCode: undefined });
      }
      working = advancePhase(session, status);
    } catch (err) {
      log.warn("poll failed", { channelId, sessionKey, error: String(err) });
    }
  }

  log.debug("login poll", { channelId, sessionKey, phase: working.phase, durationMs: elapsedMs(startedAt) });
  return NextResponse.json({
    phase: working.phase,
    message: working.message,
    account: working.account
      ? { accountId: working.account.accountId, userId: working.account.userId }
      : undefined,
  });
}

function advancePhase(
  session: LoginSession,
  status: {
    status: string;
    bot_token?: string;
    ilink_bot_id?: string;
    baseurl?: string;
    ilink_user_id?: string;
    redirect_host?: string;
  },
): LoginSession {
  const key = session.sessionKey;
  const set = (patch: Partial<LoginSession>): LoginSession => updateSession(key, patch) ?? session;

  switch (status.status) {
    case "wait":
      return set({ phase: "waiting" });
    case "scaned":
      return set({ phase: "scanned" });
    case "need_verifycode":
      return set({ phase: "verifying", message: "channels.msg.needVerifyCode" });
    case "verify_code_blocked":
      return set({ phase: "verify_blocked", message: "channels.msg.verifyBlocked" });
    case "scaned_but_redirect": {
      const newBase = status.redirect_host ? `https://${status.redirect_host}` : session.baseUrl;
      return set({ phase: "redirected", baseUrl: newBase });
    }
    case "expired":
      return set({ phase: "expired", message: "channels.msg.qrExpired" });
    case "binded_redirect":
      return set({ phase: "already_bound", message: "channels.msg.alreadyBound" });
    case "confirmed": {
      if (!status.bot_token || !status.ilink_bot_id) {
        return set({ phase: "error", message: "channels.msg.missingCredentials" });
      }
      const channelId = session.channelId;
      if (!channelId || !getChannel(channelId)) {
        return set({ phase: "error", message: "channels.msg.channelMissing" });
      }
      const account = {
        accountId: status.ilink_bot_id,
        token: status.bot_token,
        baseUrl: status.baseurl || session.baseUrl,
        userId: status.ilink_user_id,
        savedAt: new Date().toISOString(),
      };
      const existing = listChannels("wechat").find(
        (candidate) => candidate.accountId === account.accountId && candidate.id !== channelId,
      );
      if (existing) return set({ phase: "error", message: "channels.msg.accountAlreadyBound" });
      saveChannelAccount(channelId, account);
      // Re-login replaces credentials but keeps name + workspace; the
      // session binding and dedupe state are reset so the next inbound
      // message cold-starts a fresh session in this workspace.
      updateChannel(channelId, {
        status: "connected",
        accountId: account.accountId,
        userId: account.userId ?? null,
        currentSessionId: null,
        syncBuf: "",
      });
      clearChannelMessages(channelId);
      registerWorker(channelId, createWeChatWorker(channelId));
      startChannel(channelId);
      // Best-effort "bot online" announcement.
      api.notifyStart({ baseUrl: account.baseUrl, token: account.token }).catch(() => {});
      return set({ phase: "confirmed", account });
    }
    default:
      return session;
  }
}