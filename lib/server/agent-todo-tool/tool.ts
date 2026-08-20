/**
 * `agent_todo` — single custom Pi tool, action-dispatched.
 *
 * The model invokes one of `create | update | list | delete | clear`
 * in each call. The wrapper:
 *   1. reads the current task state from `~/.pi-work/agent-todo/<sid>.jsonl`,
 *   2. runs the pure reducer to produce a new state,
 *   3. appends an audit entry to the JSONL file (with fsync),
 *   4. emits an `agent_todo_state` event to in-process listeners,
 *   5. returns the standard `{ content, details }` envelope to pi.
 *
 * IMPORTANT: This file imports `@earendil-works/pi-coding-agent`, which
 * transitively pulls in server-only Node modules. Client code that needs
 * the tool name or types must import from `./types` instead.
 */

import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  AGENT_TODO_TOOL_NAME,
  type AgentTodoDetails,
  type AgentTaskState,
  type AgentTodoLogEntry,
} from "../../shared/agent-todo-tool/types";
import { applyAgentTaskMutation, type ReducerParams } from "../../shared/agent-todo-tool/reducer";
import { buildToolResult } from "../../shared/agent-todo-tool/response-envelope";
import {
  appendAgentTodoEntry,
  readAgentTodoState,
} from "./store";
import { createLogger } from "../logger";

export { AGENT_TODO_TOOL_NAME };
export type { AgentTodoAction, AgentTask, AgentTaskState, AgentTodoDetails, AgentTodoLogEntry } from "../../shared/agent-todo-tool/types";
const log = createLogger("agent-todo-tool");

// OpenAI-compatible providers require function.parameters to have a root
// `type: "object"`. A top-level Type.Union emits only `anyOf`, which worked
// through the Anthropic adapter's legacy input_schema wrapper but is rejected
// by providers such as DeepSeek. Keep action-specific requiredness in the
// reducer instead of making the wire schema a root union.
const AgentTodoParams = Type.Object(
  {
    action: StringEnum(["create", "update", "list", "delete", "clear"] as const, {
      description: "Operation to perform.",
    }),
    subject: Type.Optional(
      Type.String({
        description: "Task title for create, or updated title for update.",
      }),
    ),
    description: Type.Optional(
      Type.String({ description: "Long-form description for create or update." }),
    ),
    id: Type.Optional(Type.Number({ description: "Task id for update or delete." })),
    status: Type.Optional(
      StringEnum(["pending", "in_progress", "completed"] as const, {
        description: "Target status for update.",
      }),
    ),
  },
  { additionalProperties: false },
);

type AgentTodoParamsType = Static<typeof AgentTodoParams>;

function paramsToReducerParams(params: AgentTodoParamsType): ReducerParams {
  switch (params.action) {
    case "create":
      return {
        subject: params.subject,
        ...(params.description !== undefined ? { description: params.description } : {}),
      };
    case "update":
      return {
        id: params.id,
        ...(params.subject !== undefined ? { subject: params.subject } : {}),
        ...(params.description !== undefined ? { description: params.description } : {}),
        ...(params.status !== undefined ? { status: params.status } : {}),
      };
    case "list":
      return {};
    case "delete":
      return { id: params.id };
    case "clear":
      return {};
  }
}

function paramsForLog(params: AgentTodoParamsType): Record<string, unknown> {
  // Keep the action discriminator in its own field; don't duplicate it in params.
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key !== "action" && value !== undefined) out[key] = value;
  }
  return out;
}

export const agentTodoTool = defineTool<typeof AgentTodoParams, AgentTodoDetails>({
  name: AGENT_TODO_TOOL_NAME,
  label: "Agent Todo",
  description:
    "Track a small task list for multi-step work. Each task has a subject, an optional description, and one of three statuses: pending, in_progress, or completed.",
  parameters: AgentTodoParams,
  executionMode: "sequential",
  promptSnippet: "Track a small task list for multi-step work.",
  promptGuidelines: [
    "Use agent_todo for complex work with 5+ steps or when the user gives a task list. Skip trivial or conversational requests.",
    "Create tasks before starting multi-step work. Mark tasks in_progress before starting them and completed only when they are actually done.",
    "Use create with a subject and optional description; use update with an id and only changed fields; use list to view all tasks; use delete to remove one task; use clear when the current plan is no longer relevant.",
    "Statuses are pending, in_progress, and completed. Keep subjects short and imperative, and keep descriptions concise and focused on the work.",
  ],
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const action = params.action;
    const sessionId = ctx.sessionManager?.getSessionId?.();
    if (!sessionId) {
      return buildToolResult({
        kind: "error",
        message: "agent_todo: no session id available in tool context",
        state: { tasks: [], nextId: 1 },
      });
    }

    let current: AgentTaskState;
    try {
      current = readAgentTodoState(sessionId);
    } catch (error) {
      log.warn("agent_todo read state failed", { sessionId, error });
      return buildToolResult({
        kind: "error",
        message: `failed to read state: ${error instanceof Error ? error.message : String(error)}`,
        state: { tasks: [], nextId: 1 },
      });
    }

    const op = applyAgentTaskMutation(current, action, paramsToReducerParams(params));
    const finalState = op.kind === "error" ? current : op.state;
    const errorMessage = op.kind === "error" ? op.message : undefined;

    // Single commit point: append + fsync. Failures here abort the action —
    // we return an error result and never advance the file state.
    const entry: AgentTodoLogEntry = {
      v: 1,
      ts: Date.now(),
      sessionId,
      action,
      params: paramsForLog(params),
      stateAfter: finalState,
      ...(errorMessage !== undefined ? { error: errorMessage } : {}),
    };
    try {
      appendAgentTodoEntry(sessionId, entry);
    } catch (error) {
      log.warn("agent_todo append failed", { sessionId, error });
      return buildToolResult({
        kind: "error",
        message: `failed to persist state: ${error instanceof Error ? error.message : String(error)}`,
        state: current,
      });
    }

    // The frontend polls GET /api/agent/[id]/agent-todo — no in-process
    // broadcast needed; the file is the source of truth and the next poll
    // tick will pick up `finalState`.
    return buildToolResult(op);
  },
});

export function buildAgentTodoTool() {
  return [agentTodoTool];
}