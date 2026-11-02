import { NextResponse } from "next/server";
import { readConfig } from "@/lib/server/config";
import { isMemoryEnabledForCwd, writeMemoryCwdEnabled } from "@/lib/server/memory-cwd-store";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/memory/cwd");

function globalMemoryEnabled(): boolean {
  return readConfig().memory.enabled === true;
}

function snapshot(cwd: string) {
  const globalEnabled = globalMemoryEnabled();
  return { cwd, enabled: isMemoryEnabledForCwd(cwd, globalEnabled), globalEnabled };
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  try {
    const body = snapshot(cwd);
    log.info("memory cwd switch read", { cwd, enabled: body.enabled, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(body);
  } catch (error) {
    log.error("memory cwd switch read failed", { cwd, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const startedAt = Date.now();
  const body = (await req.json().catch(() => undefined)) as
    | { cwd?: unknown; enabled?: unknown }
    | undefined;
  if (!body || typeof body.cwd !== "string" || !body.cwd) {
    return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  try {
    writeMemoryCwdEnabled(body.cwd, body.enabled);
    const result = snapshot(body.cwd);
    log.info("memory cwd switch written", { cwd: body.cwd, enabled: body.enabled, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(result);
  } catch (error) {
    log.error("memory cwd switch write failed", { cwd: body.cwd, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
