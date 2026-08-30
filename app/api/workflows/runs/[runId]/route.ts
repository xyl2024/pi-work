/**
 * GET /api/workflows/runs/[runId] — a run plus its per-node progress.
 */
import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getWorkflowRunWithNodes } from "@/lib/server/workflow/store";

const log = createLogger("api/workflows/run-detail");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const startedAt = Date.now();
  try {
    const { runId } = await params;
    const detail = getWorkflowRunWithNodes(runId);
    if (!detail) {
      return NextResponse.json({ error: "run not found" }, { status: 404 });
    }
    log.info("workflow run fetched", { runId, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(detail);
  } catch (error) {
    log.error("workflow run fetch failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}