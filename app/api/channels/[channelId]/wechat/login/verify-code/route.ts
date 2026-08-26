/**
 * POST /api/channels/:channelId/wechat/login/verify-code
 *   body: { sessionKey, code }
 *
 *   Queues the user-entered pairing code on the login session. The next
 *   GET poll passes it to get_qrcode_status. The session must belong to
 *   the channel in the route parameter.
 */
import { NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/server/wechat/login-sessions";
import { getChannel } from "@/lib/server/channels";
import { createLogger } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/channels/wechat/login/verify-code");

type Params = { params: Promise<{ channelId: string }> };

export async function POST(req: Request, { params }: Params) {
  const { channelId } = await params;
  if (!getChannel(channelId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: { sessionKey?: unknown; code?: unknown };
  try {
    body = (await req.json()) as { sessionKey?: unknown; code?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const sessionKey = typeof body.sessionKey === "string" ? body.sessionKey : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!sessionKey) return NextResponse.json({ error: "sessionKey_required" }, { status: 400 });
  if (!code) return NextResponse.json({ error: "code_required" }, { status: 400 });

  const session = getSession(sessionKey);
  if (!session || session.channelId !== channelId) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  updateSession(sessionKey, { pendingVerifyCode: code });
  log.info("verify code queued", { channelId, sessionKey });
  return NextResponse.json({ ok: true });
}