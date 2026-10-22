/**
 * GET /api/token-audit/message-metrics?sessionId=...
 *
 * Returns `{ metrics: MessageCallMetrics[] }` — the TTFT / generation-window
 * facts of every logical model call recorded for one session, keyed by the
 * assistant message id (`String(message.timestamp)`) the chat footer joins on.
 *
 * The chat footer fetches this once per session (and again after a turn ends),
 * so the whole session is returned instead of a page: one query beats one
 * request per rendered message.
 */
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
