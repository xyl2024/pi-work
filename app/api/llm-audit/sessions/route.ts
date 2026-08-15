/**
 * GET /api/llm-audit/sessions — distinct session ids that have audited calls,
 * most recently active first, each with its latest cwd / display name read
 * straight from the audit log (no full session scan).
 */
import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/logger";
import { listAuditedSessionIds } from "@/lib/llm-audit-db";

const log = createLogger("api/llm-audit-sessions");

export async function GET() {
  const startedAt = Date.now();
  try {
    const sessions = listAuditedSessionIds();
    log.info("llm-audit sessions", { count: sessions.length, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ sessions });
  } catch (error) {
    log.error("llm-audit sessions failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
