import { NextResponse } from "next/server";
import { readConfig, writeConfig } from "@/lib/server/config";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/cwd-aliases");

/**
 * Per-cwd display alias mapping (absolute cwd path → user-set alias),
 * stored in ~/.pi-work/config.yaml under `cwd_aliases`. Reads and writes
 * bypass the full SettingsModal flow because these are set per-project
 * from the sidebar, not from the settings modal.
 */

export async function GET() {
  const startedAt = Date.now();
  try {
    const config = readConfig();
    log.info("cwd-aliases read", { durationMs: elapsedMs(startedAt) });
    return NextResponse.json(config.cwd_aliases);
  } catch (error) {
    log.error("cwd-aliases read failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json()) as { cwd?: unknown; alias?: unknown };
    if (typeof body.cwd !== "string" || body.cwd.length === 0) {
      return NextResponse.json({ error: "cwd must be a non-empty string" }, { status: 400 });
    }

    const config = readConfig();
    const next: Record<string, string> = { ...config.cwd_aliases };

    // alias === null/undefined/empty clears the override; otherwise must be
    // a non-empty string (trimmed, bounded to keep config.yaml sane).
    const alias = typeof body.alias === "string" ? body.alias.trim() : "";
    if (alias.length === 0) {
      delete next[body.cwd];
    } else {
      if (alias.length > 100) {
        return NextResponse.json({ error: "alias must be at most 100 characters" }, { status: 400 });
      }
      next[body.cwd] = alias;
    }

    writeConfig({ ...config, cwd_aliases: next });
    log.info("cwd-aliases written", { cwd: body.cwd, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ success: true, cwd_aliases: next });
  } catch (error) {
    log.error("cwd-aliases write failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
