"use client";

/**
 * `useAgentTodo` — read-side hook for the agent's task list.
 *
 * Fetches once when the active session changes, then fetches once more whenever
 * `refreshKey` changes. `useAgentSession` increments that key after an
 * `agent_todo` tool execution ends, which means the JSONL state has already
 * been committed before this hook reads it. There is no background polling.
 */

import { useEffect, useRef, useState } from "react";
import { useSettings } from "@/hooks/settingsStore";
import {
  AGENT_TODO_TOOL_NAME,
  countTasks,
  type AgentTask,
  type AgentTaskCounts,
} from "@/lib/shared/agent-todo-tool/types";

export interface UseAgentTodoResult {
  /** Current tasks from the active session. */
  tasks: readonly AgentTask[];
  /** True when there's nothing to render — caller should hide the panel. */
  empty: boolean;
  counts: AgentTaskCounts;
  /** True when the global custom tool setting currently allows fetching/rendering. */
  enabled: boolean;
}

export function useAgentTodo(
  sessionId: string | null,
  refreshKey = 0,
): UseAgentTodoResult {
  const settings = useSettings();
  const agentTodoEnabled = settings?.custom_tools.enabled.includes(AGENT_TODO_TOOL_NAME) === true;
  const sessionKey = agentTodoEnabled && sessionId ? sessionId : null;
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const sessionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const sessionChanged = sessionKeyRef.current !== sessionKey;
    sessionKeyRef.current = sessionKey;
    if (sessionChanged) setTasks([]);
    if (!sessionKey) return;

    let alive = true;
    const controller = new AbortController();

    const load = async () => {
      try {
        const res = await fetch(
          `/api/agent/${encodeURIComponent(sessionKey)}/agent-todo`,
          { signal: controller.signal },
        );
        if (!alive || !res.ok) return;
        const data = await res.json() as { tasks?: AgentTask[] };
        if (alive) setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      } catch {
        // A failed refresh is not retried automatically. The next session
        // change or agent_todo tool execution will trigger another fetch.
      }
    };

    void load();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [sessionKey, refreshKey]);

  return {
    tasks,
    empty: tasks.length === 0,
    counts: countTasks(tasks),
    enabled: agentTodoEnabled,
  };
}
