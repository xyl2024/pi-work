/**
 * Assembles the tool result envelope (`{ content, details }`) from the
 * reducer's tagged `op`. Keeps the tool wrapper focused on side effects
 * (storage, JSONL audit) and the reducer pure.
 */

import type { AgentTask, AgentTodoDetails } from "./types";
import type { AgentTodoOp } from "./reducer";

export interface AgentTodoToolResult {
  content: [{ type: "text"; text: string }];
  details: AgentTodoDetails;
}

function makeDetails(tasks: AgentTask[], error?: string): AgentTodoDetails {
  return {
    tasks,
    ...(error !== undefined ? { error } : {}),
  };
}

function fmtTask(t: AgentTask): string {
  return `[${t.status}] #${t.id} ${t.subject}`;
}

export function buildToolResult(op: AgentTodoOp): AgentTodoToolResult {
  if (op.kind === "error") {
    return {
      content: [{ type: "text" as const, text: `Error: ${op.message}` }],
      details: makeDetails(op.state.tasks, op.message),
    };
  }

  if (op.kind === "create") {
    return {
      content: [{ type: "text" as const, text: `Created task: ${fmtTask(op.task)}` }],
      details: makeDetails(op.state.tasks),
    };
  }

  if (op.kind === "update") {
    return {
      content: [{ type: "text" as const, text: `Updated task: ${fmtTask(op.task)}` }],
      details: makeDetails(op.state.tasks),
    };
  }

  if (op.kind === "delete") {
    return {
      content: [{ type: "text" as const, text: `Deleted task #${op.task.id}` }],
      details: makeDetails(op.state.tasks),
    };
  }

  if (op.kind === "list") {
    if (op.tasks.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No tasks." }],
        details: makeDetails(op.state.tasks),
      };
    }
    const header = `${op.tasks.length} task(s):`;
    const body = op.tasks.map(fmtTask).join("\n");
    return {
      content: [{ type: "text" as const, text: `${header}\n${body}` }],
      details: makeDetails(op.state.tasks),
    };
  }

  // clear
  return {
    content: [{ type: "text" as const, text: "Cleared all tasks." }],
    details: makeDetails(op.state.tasks),
  };
}
