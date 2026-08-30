/**
 * POST /api/workflows/[id]/run — manually fire a workflow right now.
 *
 * Optional body: `{ input?: Record<string,string> }` whose values become
 * `{{trigger.input.<key>}}` in node prompts. Returns the new run id; the
 * client polls /api/workflows/runs/[runId].
 */
import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getWorkflow, WorkflowNotFoundError } from "@/lib/server/workflow/store";
import { runWorkflow } from "@/lib/server/workflow/engine";
import type { WorkflowTriggerInput } from "@/lib/shared/workflow";

const log = createLogger("api/workflows/run");

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  try {
    const { id } = await params;
    const workflow = getWorkflow(id);
    if (!workflow) throw new WorkflowNotFoundError(id);

    let triggerInput: WorkflowTriggerInput | null = null;
    try {
      const body = (await req.json()) as { input?: WorkflowTriggerInput };
      if (body?.input && typeof body.input === "object") {
        triggerInput = Object.fromEntries(
          Object.entries(body.input).filter(([, v]) => typeof v === "string"),
        ) as WorkflowTriggerInput;
      }
    } catch {
      // No/empty body → run with no trigger input.
    }

    const run = await runWorkflow(id, "manual", triggerInput);
    log.info("workflow triggered manually", { id, runId: run.id, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ runId: run.id });
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    log.error("manual workflow run failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}