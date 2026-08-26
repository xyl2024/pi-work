import { NextResponse } from "next/server";
import { getChannel, updateChannel } from "@/lib/server/channels";
import { validateWorkspaceId, WorkspaceError } from "@/lib/server/channels/workspace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ channelId: string }> };

export async function GET(_: Request, { params }: Params) {
  const { channelId } = await params;
  const channel = getChannel(channelId);
  if (!channel) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ currentWorkspaceId: channel.workspaceId, currentSessionId: channel.currentSessionId });
}

export async function POST(req: Request, { params }: Params) {
  const { channelId } = await params;
  const channel = getChannel(channelId);
  if (!channel) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: { workspaceId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const raw = typeof body.workspaceId === "string" ? body.workspaceId : "";

  let workspaceId: string;
  try {
    // Server-side path validation: allowed root + real directory.
    workspaceId = await validateWorkspaceId(raw);
  } catch (err) {
    if (err instanceof WorkspaceError) {
      return NextResponse.json({ error: err.code }, { status: 400 });
    }
    return NextResponse.json({ error: "workspace_invalid" }, { status: 400 });
  }

  // Switching workspace clears the channel's current session — the next
  // inbound message cold-starts a fresh session in the new workspace.
  const next = updateChannel(channelId, { workspaceId, currentSessionId: null });
  return NextResponse.json({ currentWorkspaceId: next?.workspaceId ?? null, currentSessionId: null });
}