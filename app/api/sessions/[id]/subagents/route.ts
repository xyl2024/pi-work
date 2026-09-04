import { NextResponse } from "next/server";
import { listSubagentTasks } from "@/lib/server/subagent-store";
import { createLogger } from "@/lib/server/logger";
import type { SubagentTaskSummary } from "@/lib/shared/types";

const log = createLogger("api/sessions/[id]/subagents");

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/sessions/[id]/subagents — list children spawned by this session. */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const tasks: SubagentTaskSummary[] = listSubagentTasks(id).map((task) => ({
      taskId: task.taskId,
      childSessionId: task.childSessionId,
      subagentType: task.subagentType,
      description: task.description,
      status: task.status,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
    }));
    return NextResponse.json(
      { tasks },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    log.error("list subagent sessions failed", { id, error });
    return NextResponse.json({ error: "Failed to load subagent sessions" }, { status: 500 });
  }
}
