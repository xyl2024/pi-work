/**
 * GET /api/mcp/[name]/tools?refresh=0|1
 *
 * Returns the cached tool list. With `refresh=1`, the manager re-runs
 * `client.listTools()` and overwrites its cache before responding.
 */

import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/logger";
import { mcpManager } from "@/lib/mcp/manager";

export const dynamic = "force-dynamic";

const log = createLogger("api/mcp/[name]/tools");

export async function GET(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  const decoded = decodeURIComponent(name);
  const { searchParams } = new URL(req.url);
  const refresh = searchParams.get("refresh") === "1";
  const startedAt = Date.now();
  try {
    const tools = await mcpManager.listTools(decoded, { refresh });
    log.info("mcp tools listed", {
      name: decoded,
      count: tools.length,
      refresh,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ tools });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn("mcp listTools failed", {
      name: decoded,
      error: msg,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
