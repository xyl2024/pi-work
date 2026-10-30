import { NextResponse } from "next/server";
import { stopAllSubagentTasksForParent } from "@/lib/server/subagent-tasks";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("api/sessions/[id]/subagents/stop-all");

type RouteContext = { params: Promise<{ id: string }> };

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
