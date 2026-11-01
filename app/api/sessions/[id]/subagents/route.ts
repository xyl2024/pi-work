import { NextResponse } from "next/server";
import { listSubagentTasks } from "@/lib/server/subagent-store";
import { resolveSubagentTaskStatus } from "@/lib/server/subagent-queries";
import { readSubagentSessionViews } from "@/lib/server/subagent-session-views";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("api/sessions/[id]/subagents");

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const base = listSubagentTasks(id).map((task) => ({
      taskId: task.taskId,
      childSessionId: task.childSessionId,
      subagentName: task.subagentName,
      description: task.description,
      origin: task.origin,
      status: resolveSubagentTaskStatus(task),
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
    }));
    const sessions = await readSubagentSessionViews(base);
    return NextResponse.json(
      { tasks: base, sessions },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    log.error("list subagent sessions failed", { id, error });
    return NextResponse.json({ error: "Failed to load subagent sessions" }, { status: 500 });
  }
}
