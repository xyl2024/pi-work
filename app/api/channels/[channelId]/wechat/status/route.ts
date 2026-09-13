import { NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import { getChannel, isRunning } from "@/lib/server/channels";
import { getWorkerHealth } from "@/lib/server/channels/health";
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

  // Worker health: peak the persisted heartbeat table. `alive` derives
  // from a fresh last poll (more reliable than the in-memory isRunning
  // registry across the instrumentation/handler module split).
  const health = getWorkerHealth(channelId);
  const now = Date.now();
  const FRESH_MS = 30_000;
  const parse = (iso: string | null) => (iso ? Date.parse(iso) : 0);
  const lastPollMs = health?.lastPollAt ? Date.parse(health.lastPollAt) : 0;
  const alive =
    (health?.lastPollAt != null && isNaN(lastPollMs) ? false : now - lastPollMs < FRESH_MS);
  const backingOff =
    (health?.consecutiveFailures ?? 0) > 0 &&
    (health?.nextRetryAt != null && now < parse(health.nextRetryAt));
  const retryInMs = backingOff && health?.nextRetryAt ? Math.max(0, parse(health.nextRetryAt) - now) : null;

  return NextResponse.json({
    channel,
    configured: Boolean(account),
    accountId: account?.accountId ?? null,
    userId: account?.userId ?? channel.userId ?? null,
    status: channel.status,
    currentWorkspaceId: channel.workspaceId,
    currentSessionId: channel.currentSessionId,
    workspaceAvailable,
    monitorRunning: isRunning(channelId),
    health: {
      alive,
      backingOff,
      consecutiveFailures: health?.consecutiveFailures ?? 0,
      lastPollAt: health?.lastPollAt ?? null,
      lastFailureAt: health?.lastFailureAt ?? null,
      nextRetryAt: health?.nextRetryAt ?? null,
      retryInMs,
    },
  });
}