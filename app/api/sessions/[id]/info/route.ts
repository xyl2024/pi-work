import { NextResponse } from "next/server";
import { listAllSessionsHeaderOnly } from "@/lib/server/session-reader";
import { getRpcSession } from "@/lib/server/rpc-manager";
import { permissionModeField, readSessionPermissionModes } from "@/lib/server/session-permission-mode";
import { createLogger, elapsedMs } from "@/lib/server/logger";

const log = createLogger("api/sessions/[id]/info");

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
      session: {
        ...info,
        running: getRpcSession(info.id)?.isRunning() ?? false,
        ...permissionModeField(readSessionPermissionModes(), info.id),
      },
    });
  } catch (error) {
    log.error("session info failed", { id, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
