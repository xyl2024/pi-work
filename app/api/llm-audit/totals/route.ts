/**
 * GET /api/llm-audit/totals — KPI numbers for the audit panel header.
 */
import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { auditTotals } from "@/lib/server/llm-audit-db";

const log = createLogger("api/llm-audit-totals");

export async function GET() {
  const startedAt = Date.now();
  try {
    const totals = auditTotals();
    log.info("llm-audit totals", { totals, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(totals);
  } catch (error) {
    log.error("llm-audit totals failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
