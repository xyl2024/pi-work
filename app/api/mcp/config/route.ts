/**
 * GET /api/mcp/config  → read `~/.pi-work/mcp.json`
 * PUT /api/mcp/config  → validate + atomic-write `~/.pi-work/mcp.json`
 *
 * The validation in `PUT` lives in `lib/mcp/config-store.ts#validateMcpConfig`
 * and reuses the same parser as `readMcpConfig`, so a freshly-PUT config
 * always round-trips through `read` cleanly. We deliberately do NOT
 * signal the live `mcpManager` here — the manager re-reads the config
 * on its next `connect()` / `listTools()`, so a user who restarts a
 * connection picks up the change.
 */

import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/logger";
import {
  readMcpConfig,
  validateMcpConfig,
  writeMcpConfig,
  getMcpConfigPath,
} from "@/lib/mcp/config-store";

export const dynamic = "force-dynamic";

const log = createLogger("api/mcp/config");

export async function GET() {
  const startedAt = Date.now();
  try {
    const config = readMcpConfig();
    log.info("mcp config read", {
      servers: config.servers.length,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({
      ...config,
      path: getMcpConfigPath(),
    });
  } catch (error) {
    log.error("mcp config read failed", {
      error,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json()) as unknown;
    let validated;
    try {
      validated = validateMcpConfig(body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("mcp config rejected", { error: msg, durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    writeMcpConfig(validated);
    log.info("mcp config written", {
      servers: validated.servers.length,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ success: true, servers: validated.servers.length });
  } catch (error) {
    log.error("mcp config write failed", {
      error,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
