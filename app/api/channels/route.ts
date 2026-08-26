import { NextResponse } from "next/server";
import { createChannel, listChannels } from "@/lib/server/channels";
import type { ChannelProvider } from "@/lib/shared/channels/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider") as ChannelProvider | null;
  return NextResponse.json({ channels: listChannels(provider || undefined) });
}

export async function POST(req: Request) {
  let body: { name?: unknown; provider?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const provider = body.provider === "wechat" ? "wechat" : null;
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (!provider) return NextResponse.json({ error: "unsupported_provider" }, { status: 400 });
  if (name.length > 50) return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  return NextResponse.json({ channel: createChannel(name, provider) }, { status: 201 });
}
