import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { clearAllData } from "@/lib/server/token-audit-store";

const log = createLogger("api/token-audit-data");

export async function DELETE() {
  const startedAt = Date.now();
  try {
    const result = clearAllData();
    log.info("token-audit cleared via api", {
      deleted: result.deleted,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json(result);
  } catch (error) {
    log.error("token-audit clear failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
