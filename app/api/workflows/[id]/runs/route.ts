/**
 * GET /api/workflows/[id]/runs — recent run history for a workflow.
 */
import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getWorkflow, listWorkflowRuns, WorkflowNotFoundError } from "@/lib/server/workflow/store";

const log = createLogger("api/workflows/runs");

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  try {
    const { id } = await params;
    const workflow = getWorkflow(id);
    if (!workflow) throw new WorkflowNotFoundError(id);

    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const runs = listWorkflowRuns(id, Number.isFinite(limit) ? limit : 50);

    log.info("workflow runs listed", { id, count: runs.length, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ runs });
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    log.error("workflow runs list failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}