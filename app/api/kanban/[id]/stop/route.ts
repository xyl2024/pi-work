import { NextResponse } from "next/server";
import { getTask } from "@/lib/server/kanban/store";
import { getRpcSession } from "@/lib/server/session-registry";

/**
 * POST /api/kanban/[id]/stop — gracefully abort a running task.
 *
 * Sends `{type:"abort"}` to the task's live pi session. The runner's
 * agent_end handler observes the `aborted` stopReason and, per the product
 * decision, moves the card into review_test with the stop reason recorded.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) {
    return NextResponse.json({ error: "kanban task not found" }, { status: 404 });
  }
  if (task.status !== "in_progress") {
    return NextResponse.json(
      { error: `task is ${task.status}, not running` },
      { status: 409 },
    );
  }
  const sessionId = task.sessionId;
  if (!sessionId) {
    return NextResponse.json(
      { error: "session has not started yet" },
      { status: 409 },
    );
  }
  const wrapper = getRpcSession(sessionId);
  if (!wrapper || !wrapper.isAlive()) {
    return NextResponse.json(
      { error: "task session is not alive" },
      { status: 409 },
    );
  }

  try {
    await wrapper.send({ type: "abort" });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}