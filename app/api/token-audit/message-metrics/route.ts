import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { listMessageCallMetrics } from "@/lib/server/token-audit-store";

const log = createLogger("api/token-audit-message-metrics");

export async function GET(req: Request) {
  const startedAt = Date.now();
  const sessionId = new URL(req.url).searchParams.get("sessionId")?.trim() ?? "";
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  try {
    const metrics = listMessageCallMetrics(sessionId);
    log.info("token-audit message metrics", {
      sessionId,
      returned: metrics.length,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ metrics });
  } catch (error) {
    log.error("token-audit message metrics failed", { sessionId, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
