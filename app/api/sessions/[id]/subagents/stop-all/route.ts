import { NextResponse } from "next/server";
import { stopAllSubagentTasksForParent } from "@/lib/server/subagent-tasks";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("api/sessions/[id]/subagents/stop-all");

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/sessions/[id]/subagents/stop-all
 *
 * The user's independent stop-all entry: it exists for the window after the
 * parent turn has already ended while background child tasks are still
 * unfinished. It goes through the same helper as the parent turn's abort
 * command and parent deletion, so all three entries share one rule (and none
 * of them creates a task manager as a side effect of stopping).
 *
 * Returns the number of tasks the stop request reached and whether the parent
 * is still in its stopping window; the UI reloads the task list for the real
 * per-task states.
 */
export async function POST(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const result = stopAllSubagentTasksForParent(id);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    log.error("stop all subagent tasks failed", { id, error });
    return NextResponse.json({ error: "Failed to stop subagent tasks" }, { status: 500 });
  }
}
