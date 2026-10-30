import { NextResponse } from "next/server";
import { readConfig, writeConfig } from "@/lib/server/config";
import { isCwdIconValue } from "@/lib/shared/cwd-icon";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/cwd-icons");

export async function GET() {
  const startedAt = Date.now();
  try {
    const config = readConfig();
    log.info("cwd-icons read", { durationMs: elapsedMs(startedAt) });
    return NextResponse.json(config.cwd_icons);
  } catch (error) {
    log.error("cwd-icons read failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json()) as { cwd?: unknown; icon?: unknown };
    if (typeof body.cwd !== "string" || body.cwd.length === 0) {
      return NextResponse.json({ error: "cwd must be a non-empty string" }, { status: 400 });
    }

    const config = readConfig();
    const next: Record<string, string> = { ...config.cwd_icons };

    if (body.icon === null || body.icon === undefined) {
      delete next[body.cwd];
    } else {
      if (typeof body.icon !== "string" || !isCwdIconValue(body.icon)) {
        return NextResponse.json({ error: `unknown icon "${String(body.icon)}"` }, { status: 400 });
      }
      next[body.cwd] = body.icon;
    }

    writeConfig({ ...config, cwd_icons: next });
    log.info("cwd-icons written", { cwd: body.cwd, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ success: true, cwd_icons: next });
  } catch (error) {
    log.error("cwd-icons write failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}