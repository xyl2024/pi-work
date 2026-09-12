import { NextResponse } from "next/server";
import { createTask, listTasks, reconcileStaleTasks } from "@/lib/server/kanban/store";
import type { KanbanTask } from "@/lib/shared/kanban-types";
import type { CreateKanbanTaskInput } from "@/lib/shared/kanban-types";
import { readKanbanSessionStats } from "@/lib/server/kanban/session-stats";

// GET /api/kanban — list all tasks across columns. Before listing, sweep for
// zombie in_progress cards whose session is gone (grace-window protected, so a
// freshly-reserved run is never falsely killed) and move them to review_test.
// Each task that carries a linked session also gets its run stats (message /
// tool-call / file / line counts) attached, so the board can render them.
export async function GET() {
  reconcileStaleTasks();
  const tasks: KanbanTask[] = listTasks();
  await Promise.all(
    tasks.map(async (task) => {
      if (!task.sessionId) return;
      task.stats = await readKanbanSessionStats(task.sessionId);
    }),
  );
  return NextResponse.json({ tasks });
}

// POST /api/kanban — create a task (lands in Backlog).
export async function POST(req: Request) {
  let body: CreateKanbanTaskInput;
  try {
    body = (await req.json()) as CreateKanbanTaskInput;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const task = createTask(body);
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && "field" in err) {
      return NextResponse.json(
        { error: err.message, field: (err as { field: string }).field },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}