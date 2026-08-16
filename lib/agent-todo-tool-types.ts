/**
 * Client-safe constants, types, and pure helpers for the `agent_todo` tool.
 *
 * This file MUST NOT import `@earendil-works/pi-coding-agent` or any
 * server-only Node module — it's imported by client components
 * (`components/AgentTodoPanel.tsx`, `hooks/useAgentTodo.tsx`) to match
 * the tool name and types without pulling server-only code into the
 * browser bundle.
 */

export const AGENT_TODO_TOOL_NAME = "agent_todo";

/** Action discriminator for the single `agent_todo` tool. */
export type AgentTodoAction =
  | "create"
  | "update"
  | "list"
  | "delete"
  | "clear";

export type AgentTaskStatus = "pending" | "in_progress" | "completed";

export interface AgentTask {
  id: number;
  subject: string;
  description?: string;
  status: AgentTaskStatus;
}

export interface AgentTaskState {
  tasks: AgentTask[];
  nextId: number;
}

export interface AgentTodoDetails {
  tasks: AgentTask[];
  error?: string;
}

/** One row of `~/.pi-work/agent-todo/<sessionId>.jsonl`. */
export interface AgentTodoLogEntry {
  v: 1;
  ts: number;
  sessionId: string;
  action: AgentTodoAction;
  params: Record<string, unknown>;
  stateAfter: AgentTaskState;
  error?: string;
}

export const EMPTY_STATE: AgentTaskState = { tasks: [], nextId: 1 };

export interface AgentTaskCounts {
  pending: number;
  inProgress: number;
  completed: number;
  total: number;
}

/** Counts used in the panel header. */
export function countTasks(tasks: readonly AgentTask[]): AgentTaskCounts {
  let pending = 0;
  let inProgress = 0;
  let completed = 0;
  for (const t of tasks) {
    if (t.status === "pending") pending++;
    else if (t.status === "in_progress") inProgress++;
    else if (t.status === "completed") completed++;
  }
  return { pending, inProgress, completed, total: pending + inProgress + completed };
}
