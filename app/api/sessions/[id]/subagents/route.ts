import { NextResponse } from "next/server";
import { listSubagentTasks } from "@/lib/server/subagent-store";
import { readSubagentSessionStats } from "@/lib/server/sessions/reader";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("api/sessions/[id]/subagents");

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/sessions/[id]/subagents — list children spawned by this session. */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const base = listSubagentTasks(id).map((task) => ({
      taskId: task.taskId,
      childSessionId: task.childSessionId,
      subagentType: task.subagentType,
      description: task.description,
      status: task.status,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
    }));
    const tasks = await Promise.all(
      base.map(async (task) => {
        const stats = task.childSessionId ? await readSubagentSessionStats(task.childSessionId) : null;
        return {
          ...task,
          assistantCount: stats?.assistantCount ?? null,
          readCount: stats?.readCount ?? null,
          model: stats?.model ?? null,
        };
      }),
    );
    return NextResponse.json(
      { tasks },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    log.error("list subagent sessions failed", { id, error });
    return NextResponse.json({ error: "Failed to load subagent sessions" }, { status: 500 });
  }
}
