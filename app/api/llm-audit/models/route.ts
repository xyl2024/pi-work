/**
 * GET /api/llm-audit/models — distinct audited model ids (for the filter).
 */
import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { listAuditedModelIds } from "@/lib/server/llm-audit-db";

const log = createLogger("api/llm-audit-models");

export async function GET() {
  const startedAt = Date.now();
  try {
    const models = listAuditedModelIds();
    log.info("llm-audit models", { count: models.length, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ models });
  } catch (error) {
    log.error("llm-audit models failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
