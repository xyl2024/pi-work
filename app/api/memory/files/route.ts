import { NextResponse } from "next/server";
import { readConfig } from "@/lib/server/config";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { listMemoryFiles } from "@/lib/server/memory-files";

export const dynamic = "force-dynamic";

const log = createLogger("api/memory/files");

function memoryDisabled(): NextResponse {
  return NextResponse.json({ error: "Memory is not enabled" }, { status: 404 });
}

export async function GET() {
  const startedAt = Date.now();
  if (readConfig().memory.enabled !== true) {
    const response = memoryDisabled();
    log.info("memory files list rejected", { status: response.status, durationMs: elapsedMs(startedAt) });
    return response;
  }
  try {
    const files = listMemoryFiles();
    log.info("memory files listed", { count: files.length, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ files });
  } catch (error) {
    log.error("memory files list failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
