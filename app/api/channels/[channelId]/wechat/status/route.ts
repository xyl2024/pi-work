import { NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import { getChannel, isRunning } from "@/lib/server/channels";
import { loadChannelAccount } from "@/lib/server/channels/credentials";
import { isPathAllowed, getAllowedRoots } from "@/lib/server/file-access";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const channel = getChannel(channelId);
  if (!channel) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const account = loadChannelAccount(channelId);

  let workspaceAvailable: boolean | null = null;
  if (channel.workspaceId) {
    try {
      workspaceAvailable =
        existsSync(channel.workspaceId) &&
        statSync(channel.workspaceId).isDirectory() &&
        isPathAllowed(channel.workspaceId, await getAllowedRoots());
    } catch {
      workspaceAvailable = false;
    }
  }

  return NextResponse.json({
    channel,
    configured: Boolean(account),
    accountId: account?.accountId ?? null,
    userId: account?.userId ?? channel.userId ?? null,
    status: account?.status ?? channel.status,
    currentWorkspaceId: channel.workspaceId,
    currentSessionId: account?.currentSessionId ?? channel.currentSessionId ?? null,
    workspaceAvailable,
    monitorRunning: isRunning(channelId),
  });
}