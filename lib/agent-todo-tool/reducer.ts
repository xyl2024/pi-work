/**
 * Pure reducer for the `agent_todo` tool.
 *
 * `applyAgentTaskMutation(state, action, params)` validates the request,
 * mutates a copy of the state, and returns either a new state + a tagged
 * `op` describing what happened, or an `error` op with a human-readable
 * message. It never throws — callers get a tagged union.
 *
 * State semantics:
 * - `nextId` is monotonically increasing. `create` consumes one.
 * - `delete` removes the task from the current state; the audit log retains
 *   the action history.
 */

import {
  type AgentTask,
  type AgentTaskState,
  type AgentTodoAction,
} from "../agent-todo-tool-types";

export type AgentTodoOp =
  | { kind: "create"; task: AgentTask; state: AgentTaskState }
  | { kind: "update"; task: AgentTask; state: AgentTaskState }
  | { kind: "delete"; task: AgentTask; state: AgentTaskState }
  | { kind: "list"; state: AgentTaskState; tasks: AgentTask[] }
  | { kind: "clear"; state: AgentTaskState }
  | { kind: "error"; message: string; state: AgentTaskState };

/**
 * Subset of tool params that the reducer inspects. Keeping the type loose
 * (rather than importing the TypeBox schema) keeps this module synchronous
 * and free of server-only SDK imports — the tool wrapper validates against
 * the schema before calling.
 */
export interface ReducerParams {
  subject?: string;
  description?: string;
  id?: number;
  status?: AgentTask["status"];
}

export function applyAgentTaskMutation(
  state: AgentTaskState,
  action: AgentTodoAction,
  params: ReducerParams,
): AgentTodoOp {
  switch (action) {
    case "create": {
      if (typeof params.subject !== "string" || params.subject.trim().length === 0) {
        return { kind: "error", message: "subject is required for create", state };
      }
      const id = state.nextId;
      const task: AgentTask = {
        id,
        subject: params.subject.trim(),
        status: "pending",
        ...(typeof params.description === "string" ? { description: params.description } : {}),
      };
      const next: AgentTaskState = {
        tasks: [...state.tasks, task],
        nextId: state.nextId + 1,
      };
      return { kind: "create", task, state: next };
    }

    case "update": {
      if (typeof params.id !== "number") {
        return { kind: "error", message: "id is required for update", state };
      }
      const idx = state.tasks.findIndex((t) => t.id === params.id);
      if (idx < 0) return { kind: "error", message: `task ${params.id} not found`, state };
      const current = state.tasks[idx];
      const next: AgentTask = { ...current };
      if (typeof params.subject === "string") next.subject = params.subject.trim();
      if (typeof params.description === "string") next.description = params.description;

      if (typeof params.status === "string") {
        next.status = params.status;
      }

      const tasks = state.tasks.slice();
      tasks[idx] = next;
      return { kind: "update", task: next, state: { tasks, nextId: state.nextId } };
    }

    case "delete": {
      if (typeof params.id !== "number") {
        return { kind: "error", message: "id is required for delete", state };
      }
      const idx = state.tasks.findIndex((t) => t.id === params.id);
      if (idx < 0) return { kind: "error", message: `task ${params.id} not found`, state };
      const task = state.tasks[idx];
      const tasks = state.tasks.filter((_, taskIndex) => taskIndex !== idx);
      return { kind: "delete", task, state: { tasks, nextId: state.nextId } };
    }

    case "list": {
      return { kind: "list", state, tasks: state.tasks };
    }

    case "clear": {
      return { kind: "clear", state: { tasks: [], nextId: state.nextId } };
    }

    default:
      return {
        kind: "error",
        message: `Unknown action: ${String(action)}`,
        state,
      };
  }
}