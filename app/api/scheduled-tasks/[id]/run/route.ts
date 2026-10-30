import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getTask, recordRunStart, SchedulerNotFoundError } from "@/lib/server/scheduler/store";
import { runTask } from "@/lib/server/scheduler/runner";

const log = createLogger("api/scheduled-tasks/run");

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  try {
    const { id } = await params;
    const task = getTask(id);
    if (!task) throw new SchedulerNotFoundError(id);
    const run = recordRunStart(task.id);
    void runTask(task, run.id);
    log.info("task triggered manually", { id, runId: run.id, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ runId: run.id });
  } catch (error) {
    if (error instanceof SchedulerNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    log.error("manual run failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}