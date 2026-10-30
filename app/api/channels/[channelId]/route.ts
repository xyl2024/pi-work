import { NextResponse } from "next/server";
import { deleteChannel, getChannel, setEnabled, stopChannel, updateChannel } from "@/lib/server/channels";
import { ensureWeChatWorkerRunning } from "@/lib/server/channels/wechat-worker";
import { deleteChannelAccount } from "@/lib/server/channels/credentials";

import { clearChannelMessages } from "@/lib/server/channels/messages";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ channelId: string }> };

export async function GET(_: Request, { params }: Params) {
  const { channelId } = await params;
  const channel = getChannel(channelId);
  return channel ? NextResponse.json({ channel }) : NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Params) {
  const { channelId } = await params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > 50) return NextResponse.json({ error: "invalid_name" }, { status: 400 });
    patch.name = name;
  }
  if (body.status === "connected" || body.status === "disabled") {
    if (body.status === "connected") {
      ensureWeChatWorkerRunning(channelId);
    }
    if (!setEnabled(channelId, body.status === "connected")) return NextResponse.json({ error: "invalid_status_transition" }, { status: 400 });
  } else if (["pending", "expired"].includes(String(body.status))) patch.status = body.status;
  const channel = updateChannel(channelId, patch as never);
  return channel ? NextResponse.json({ channel }) : NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function DELETE(_: Request, { params }: Params) {
  const { channelId } = await params;
  const channel = getChannel(channelId);
  if (!channel) return NextResponse.json({ error: "not_found" }, { status: 404 });
  stopChannel(channelId);
  deleteChannelAccount(channelId);
  clearChannelMessages(channelId);
  if (!deleteChannel(channelId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
