import { NextResponse } from "next/server";
import {
  readSessionNotify,
  writeSessionNotify,
  deleteSessionNotify,
} from "@/lib/server/session-notify";
import { getChannel } from "@/lib/server/channels";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("api/sessions/notify");

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/sessions/[id]/notify
// Returns the session's notification-channel config, or null when unset.
export async function GET(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  return NextResponse.json({ config: readSessionNotify(id) });
}

// PUT /api/sessions/[id]/notify  body: { channelId: string }
// Validate the channel (must be a connected WeChat channel with a bound user),
// then persist it as this session's reply-notification target. An empty
// channelId clears the config.
export async function PUT(req: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const body = await req.json() as { channelId?: unknown };
    const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";

    if (!channelId) {
      writeSessionNotify(id, "");
      return NextResponse.json({ config: null });
    }

    const channel = getChannel(channelId);
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    if (channel.provider !== "wechat") {
      return NextResponse.json({ error: "Unsupported channel provider" }, { status: 400 });
    }
    if (channel.status !== "connected") {
      return NextResponse.json({ error: "Channel is not connected" }, { status: 400 });
    }
    if (!channel.userId) {
      return NextResponse.json({ error: "Channel has no bound user" }, { status: 400 });
    }

    const ok = writeSessionNotify(id, channelId);
    if (!ok) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }
    log.info("session notification channel set", { sessionId: id, channelId });
    return NextResponse.json({ config: readSessionNotify(id) });
  } catch (error) {
    log.warn("set session notification failed", { sessionId: id, error: String(error) });
    return NextResponse.json({ error: "Failed to save notification config" }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]/notify — clear the session's notification target.
export async function DELETE(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  deleteSessionNotify(id);
  return NextResponse.json({ ok: true });
}
