/**
 * GET /api/mcp — list configured servers + their live connection views.
 *
 * No `POST/PATCH/DELETE` here — config edits go through
 * `PUT /api/mcp/config`; connection changes go through `[name]`.
 */

import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/logger";
import { mcpManager } from "@/lib/mcp/manager";

export const dynamic = "force-dynamic";

const log = createLogger("api/mcp");

export async function GET() {
  const startedAt = Date.now();
  try {
    const { config, views } = mcpManager.listServers();
    log.info("mcp servers listed", {
      count: views.length,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ ...config, servers: views });
  } catch (error) {
    log.error("mcp list failed", {
      error,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
