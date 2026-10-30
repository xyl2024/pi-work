import { NextResponse } from "next/server";
import { getChannel } from "@/lib/server/channels";
import { listActivity } from "@/lib/server/channels/activity";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ channelId: string }> };

export async function GET(req: Request, { params }: Params) {
  const { channelId } = await params;
  if (!getChannel(channelId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const limit = Math.max(1, Math.min(200, Number(new URL(req.url).searchParams.get("limit")) || 50));
  return NextResponse.json({ activity: listActivity(channelId, limit) });
}