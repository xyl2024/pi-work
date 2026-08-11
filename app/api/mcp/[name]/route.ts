/**
 * POST   /api/mcp/[name]  — start (or re-establish) a connection
 * DELETE /api/mcp/[name]  — disconnect
 *
 * Both return the live `McpServerView` of the named server, including
 * status + tool list (POST) or status only (DELETE).
 */

import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/logger";
import { mcpManager } from "@/lib/mcp/manager";

export const dynamic = "force-dynamic";

const log = createLogger("api/mcp/[name]");

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  const decoded = decodeURIComponent(name);
  const startedAt = Date.now();
  try {
    const view = await mcpManager.connect(decoded);
    log.info("mcp server connect", {
      name: decoded,
      status: view.status,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json(view);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn("mcp connect failed", {
      name: decoded,
      error: msg,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  const decoded = decodeURIComponent(name);
  const startedAt = Date.now();
  try {
    await mcpManager.disconnect(decoded);
    const view = mcpManager.getStatus(decoded);
    log.info("mcp server disconnect", {
      name: decoded,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json(view ?? { name: decoded, status: "disconnected" });
  } catch (error) {
    log.error("mcp disconnect failed", {
      name: decoded,
      error,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
