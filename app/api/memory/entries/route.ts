import { NextResponse } from "next/server";
import { readConfig } from "@/lib/server/config";
import { readMemoryView } from "@/lib/server/memory-store";
import type { MemoryEntriesResponse } from "@/lib/shared/memory";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/memory/entries");

export async function GET(_request: Request) {
  const startedAt = Date.now();
  try {
    const body: MemoryEntriesResponse = {
      globalEnabled: readConfig().memory.enabled === true,
      memory: readMemoryView("memory"),
      user: readMemoryView("user"),
    };
    log.info("memory entries read", {
      memoryStatus: body.memory.status,
      userStatus: body.user.status,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json(body);
  } catch (error) {
    log.error("memory entries read failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
