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

export async function GET(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  return NextResponse.json({ config: readSessionNotify(id) });
}

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

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  deleteSessionNotify(id);
  return NextResponse.json({ ok: true });
}
