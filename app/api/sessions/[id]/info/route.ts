import { NextResponse } from "next/server";
import { listAllSessionsHeaderOnly } from "@/lib/server/session-reader";
import { getRpcSession } from "@/lib/server/rpc-manager";
import { createLogger, elapsedMs } from "@/lib/server/logger";

const log = createLogger("api/sessions/[id]/info");

/**
 * GET /api/sessions/[id]/info
 *
 * Lightweight SessionInfo lookup for a single session id. Used by the sidebar
 * when an `initialSessionId` from the URL is not in any loaded page (rare —
 * most URLs point to a recent session that's already on page 1).
 *
 * Hits the same 5s-TTL header-only list cache as /api/sessions and
 * /api/workspaces, so a flow of these lookups within the window shares one
 * scan. `messageCount` will be 0 here; the unique caller (SessionSidebar
 * initial-restore merge) doesn't render this field — see
 * reader.ts:listAllSessionsHeaderOnly for the full precision trade-off list.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const startedAt = Date.now();
  try {
    const all = await listAllSessionsHeaderOnly();
    const info = all.find((s) => s.id === id);
    if (!info) {
      log.warn("session info not found", { id, durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    log.debug("session info served", {
      id,
      cwd: info.cwd,
      cacheHit: !!(globalThis as { __piSessionListHeaderCache?: unknown }).__piSessionListHeaderCache,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({
      session: { ...info, running: getRpcSession(info.id)?.isRunning() ?? false },
    });
  } catch (error) {
    log.error("session info failed", { id, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
