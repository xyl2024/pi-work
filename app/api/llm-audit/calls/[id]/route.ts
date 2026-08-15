/**
 * GET /api/llm-audit/calls/[id] — one full provider call record, including
 * the complete request body and (for errors) the complete response body.
 */
import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/logger";
import { getProviderCall } from "@/lib/llm-audit-db";

const log = createLogger("api/llm-audit-call");

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  try {
    const { id } = await params;
    const num = parseInt(id, 10);
    if (!Number.isFinite(num)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const row = getProviderCall(num);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    log.info("llm-audit call detail", { id: num, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(row);
  } catch (error) {
    log.error("llm-audit call detail failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
