import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { startRpcSession } from "@/lib/server/rpc-manager";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { normalizeProbeSource } from "@/lib/shared/web-tools";

const log = createLogger("api/agent/tools");

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as { cwd?: unknown; source?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    const source = normalizeProbeSource(body.source);
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }

    const tempKey = `__tools_probe__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { session } = await startRpcSession(tempKey, "", cwd, "all", source, { mcp: false });
    try {
      const tools = (await session.send({ type: "get_tools" })) as Array<{
        name: string;
        description: string;
        parameters?: unknown;
      }>;
      log.info("ephemeral tools listed", {
        cwd,
        source,
        count: tools.length,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json({ success: true, data: { available: tools } });
    } finally {
      session.destroy();
    }
  } catch (error) {
    log.error("ephemeral tools list failed", {
      error: String(error),
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}