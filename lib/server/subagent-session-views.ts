import { readSessionDetails, readSubagentSessionStats } from "@/lib/server/sessions/reader";
import { sessionDisplayTitle } from "@/lib/shared/session-title";
import type { SubagentSessionStatsView } from "@/lib/shared/types";

interface SubagentSessionTaskRef {
  taskId: string;
  childSessionId: string | null;
}

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

async function readSubagentSessionView(sessionId: string): Promise<SubagentSessionStatsView> {
  const [stats, details] = await Promise.all([
    readSubagentSessionStats(sessionId).catch(() => null),
    readSessionDetails(sessionId).catch(() => null),
  ]);

  return {
    sessionId,
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
    context: null,
  };
}

export async function readSubagentSessionViews(
  tasks: readonly SubagentSessionTaskRef[],
): Promise<SubagentSessionStatsView[]> {
  return Promise.all(uniqueSubagentSessionIds(tasks).map(readSubagentSessionView));
}
