import { sessionDisplayTitle } from "@/lib/shared/session-title";
import type { SubagentSessionContextUsage, SubagentSessionStatsView } from "@/lib/shared/types";
import { readSessionDetails, readSubagentSessionStats } from "@/lib/server/sessions/reader";

interface SubagentSessionTaskRef {
  taskId: string;
  childSessionId: string | null;
}

export type SubagentSessionMetricsView = Omit<SubagentSessionStatsView, "sessionId" | "context">;

export function uniqueSubagentSessionIds(
  tasks: readonly SubagentSessionTaskRef[],
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const task of tasks) {
    const id = task.childSessionId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function emptyMetrics(): SubagentSessionMetricsView {
  return {
    title: null,
    assistantCount: null,
    toolCallCount: null,
    avgTtftMs: null,
    avgGenerationTps: null,
    model: null,
  };
}

async function readOneSessionMetrics(sessionId: string): Promise<SubagentSessionMetricsView> {
  try {
    const [stats, details] = await Promise.all([
      readSubagentSessionStats(sessionId),
      readSessionDetails(sessionId),
    ]);
    return {
      title: details?.info
        ? sessionDisplayTitle({
            id: details.info.id,
            name: details.info.name,
            firstMessage: details.info.firstMessage,
          })
        : null,
      assistantCount: stats?.assistantCount ?? null,
      toolCallCount: null,
      avgTtftMs: null,
      avgGenerationTps: null,
      model: stats?.model ? { provider: null, modelId: stats.model } : null,
    };
  } catch {
    return emptyMetrics();
  }
}

async function readSessionMetricsById(
  sessionIds: readonly string[],
): Promise<Map<string, SubagentSessionMetricsView>> {
  const entries = await Promise.all(
    sessionIds.map(async (sessionId) => [sessionId, await readOneSessionMetrics(sessionId)] as const),
  );
  return new Map(entries);
}

async function readSessionContextUsage(_sessionId: string): Promise<SubagentSessionContextUsage | null> {
  return null;
}

export async function readSubagentSessionViews(
  tasks: readonly SubagentSessionTaskRef[],
): Promise<SubagentSessionStatsView[]> {
  const ids = uniqueSubagentSessionIds(tasks);
  const metricsById = await readSessionMetricsById(ids);
  return Promise.all(
    ids.map(async (sessionId) => ({
      sessionId,
      ...(metricsById.get(sessionId) ?? emptyMetrics()),
      context: await readSessionContextUsage(sessionId),
    })),
  );
}
