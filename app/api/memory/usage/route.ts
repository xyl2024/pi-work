import { NextResponse } from "next/server";
import { readMemoryUsage } from "@/lib/server/memory-store";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/memory/usage");

export async function GET() {
  const startedAt = Date.now();
  try {
    const usage = readMemoryUsage();
    log.info("memory usage read", { durationMs: elapsedMs(startedAt) });
    return NextResponse.json(usage);
  } catch (error) {
    log.error("memory usage read failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
