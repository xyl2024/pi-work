import { NextResponse } from "next/server";
import { deleteTask, updateTask } from "@/lib/server/kanban/store";
import type { UpdateKanbanTaskInput } from "@/lib/shared/kanban-types";

// PATCH /api/kanban/[id] — edit fields, move between columns, reorder.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: UpdateKanbanTaskInput;
  try {
    body = (await req.json()) as UpdateKanbanTaskInput;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const task = updateTask(id, body);
    return NextResponse.json({ task });
  } catch (err) {
    const e = err as Error & { field?: string };
    if (e.name === "KanbanNotFoundError") {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if ("field" in e) {
      return NextResponse.json({ error: e.message, field: e.field }, { status: 400 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/kanban/[id] — permanently remove a card.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    deleteTask(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}