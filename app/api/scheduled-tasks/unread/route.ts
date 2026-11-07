import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { countUnreadRuns } from "@/lib/server/scheduler/store";
import { NO_SCHEDULER_UNREAD } from "@/lib/shared/scheduler-unread";

const log = createLogger("api/scheduled-tasks/unread");

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const url = new URL(req.url);
    const sinceParam = url.searchParams.get("since");
    const since = sinceParam === null ? NaN : Number(sinceParam);
    if (!Number.isFinite(since) || since <= 0) {
      return NextResponse.json(NO_SCHEDULER_UNREAD);
    }
    const counts = countUnreadRuns(since);
    log.info("unread counted", { success: counts.success, failed: counts.failed, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(counts);
  } catch (error) {
    log.error("unread count failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
