import { NextResponse } from "next/server";
import { getSubagentTaskByChildSessionId, listSubagentChildSessionIds } from "@/lib/server/subagent-store";
import { readSubagentLiveInfo } from "@/lib/server/sessions/reader";
import { createLogger } from "@/lib/server/logger";
import type { SubagentLiveInfo } from "@/lib/shared/types";

const log = createLogger("api/subagents/[sessionId]/activity");

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * GET /api/subagents/[sessionId]/activity — live snapshot of one subagent
 * child session (stats + recent tool-call activity). Only session ids that
 * are registered as subagent children in subagents.db are readable.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { sessionId } = await params;
  try {
    const childIds = new Set(listSubagentChildSessionIds());
    if (!childIds.has(sessionId)) {
      return NextResponse.json({ error: "Not a subagent session" }, { status: 404 });
    }
    const task = getSubagentTaskByChildSessionId(sessionId);
    const info = await readSubagentLiveInfo(sessionId);
    const payload: SubagentLiveInfo = {
      task: task
        ? { status: task.status, startedAt: task.startedAt, description: task.description }
        : null,
      stats: {
        assistantCount: info?.assistantCount ?? null,
        readCount: info?.readCount ?? null,
        model: info?.model ?? null,
      },
      activities: info?.activities ?? [],
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    log.error("read subagent activity failed", { sessionId, error });
    return NextResponse.json({ error: "Failed to load subagent activity" }, { status: 500 });
  }
}
