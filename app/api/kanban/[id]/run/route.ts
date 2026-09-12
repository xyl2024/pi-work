import { NextResponse } from "next/server";
import { getTask, markRunStart } from "@/lib/server/kanban/store";
import { runTask } from "@/lib/server/kanban/runner";

/**
 * POST /api/kanban/[id]/run — start executing a Backlog task.
 *
 * The store flips backlog -> in_progress synchronously and hands back the
 * task (so a second click is refused with 409 before any session spawns),
 * then the runner cold-starts the pi session in the background and moves the
 * card into review_test when the prompt's run completes.
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
  if (task.status !== "backlog") {
    return NextResponse.json(
      { error: `task is ${task.status}, not in backlog` },
      { status: 409 },
    );
  }

  // Snapshot the config before it can be edited mid-start.
  const snapshot = { ...task };

  // Reserve the card as in_progress with a placeholder session value updated
  // by the runner once the real session id exists. We need a session_id now
  // for the row; the runner overwrites it with the real one.
  try {
    markRunStart(id, "");
  } catch (err) {
    const e = err as Error;
    if (e.name === "KanbanConflictError") {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  void runTask(snapshot);

  return NextResponse.json({ started: { taskId: id } });
}