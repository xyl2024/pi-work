// ============================================================================
// subagent ToolCallBlock state (pure)
//
// The block renders one of three things: the live child-activity panel (while
// the task is unfinished), the tool's final result, or — in the window where
// neither exists yet — just the call's own input.
//
// Which one it is comes from the result object the block was handed, which is
// either the tool's final `ToolResultMessage` (persisted by pi, or streamed
// when the tool ends) or the in-flight partial the client keeps from
// `tool_execution_update` (created on `tool_execution_start`, dropped on
// `tool_execution_end`). See `hooks/useAgentSession/events.ts`.
//
// A task can outlive the tool call that started it: when the caller's wait
// expires, the tool returns a normal result that says so (`waitExpired`) while
// the task keeps running. The panel must keep showing that truth, which is why
// "running" is derived from the task status, not from "the tool has not
// returned yet".
//
// Like `chat-timeline` / `scroll-follow` this module may not import React, the
// DOM, a client hook, or anything from `lib/server`.
// ============================================================================

import { isSubagentTerminalStatus, type SubagentTaskStatus, type ToolResultMessage } from "./types";

export function isSubagentTaskStatus(value: unknown): value is SubagentTaskStatus {
  return value === "queued"
    || value === "creating"
    || value === "running"
    || value === "stopping"
    || value === "completed"
    || value === "failed"
    || value === "cancelled"
    || value === "interrupted";
}

export interface SubagentBlockState {
  /** True while the task is unfinished: the block shows the live panel. */
  running: boolean;
  /** The task status the result carries, when it carries one. */
  status: SubagentTaskStatus | null;
  /**
   * Child session whose activity the live panel polls. Null until the child
   * session exists (the task can still be queued for a concurrency slot) and
   * whenever the block knows of no child at all.
   */
  childSessionId: string | null;
  /** Name of the profile the task runs, when the result carries it. */
  subagentName: string | null;
  /**
   * True when the tool returned because its wait expired while the task is
   * still unfinished: the task is alive in the background.
   */
  waitExpired: boolean;
  /**
   * True when the call delegated in the background (`spawn` with `wait_ms: 0`):
   * the block shows only the tool's result text, never the live panel, because
   * the caller explicitly asked not to watch the task.
   */
  backgrounded: boolean;
}

export interface SubagentBlockStateInput {
  /** The block's result: final tool result, else the in-flight partial, else undefined. */
  result: ToolResultMessage | undefined;
  /** Whether the tool call itself failed (a tool-level error, not a task status). */
  isError: boolean;
  /** The call's own input; only the `wait_ms` of a `spawn` is read. */
  input?: Record<string, unknown>;
}

/** Details payload the `subagent` tool puts on its result (see `lib/server/subagent-tool.ts`). */
interface SubagentResultDetails {
  status?: unknown;
  childSessionId?: string | null;
  /** Pre-rename field name, kept so old messages keep rendering. */
  sessionId?: string | null;
  subagentName?: string | null;
  waitExpired?: unknown;
}

export function deriveSubagentBlockState({ result, isError, input }: SubagentBlockStateInput): SubagentBlockState {
  const details = (result?.details ?? null) as SubagentResultDetails | null;
  const status = isSubagentTaskStatus(details?.status) ? details.status : null;
  const hasResultText = !!result && result.content.some((item) => item.type === "text" && item.text.trim().length > 0);
  const terminal = isError || (status !== null && isSubagentTerminalStatus(status));
  const waitExpired = details?.waitExpired === true;
  // A spawn that asked for `wait_ms: 0` returned at once on purpose: the parent
  // delegated in the background, so the block shows the tool's result text and
  // nothing live. A default (or long) wait still shows the panel.
  const backgrounded = input?.action === "spawn" && input.wait_ms === 0;
  return {
    // A run is only ever inferred from a result object we actually hold: the
    // in-flight partial pi streams while the tool executes, or the final
    // result. A missing result is NOT evidence of a run — pi emits a parallel
    // tool batch's toolResult messages only after every tool in the batch has
    // finished, so between this tool's `tool_execution_end` (which drops the
    // in-flight partial) and that batch's results the block legitimately has
    // none. Reading absence as "still running" made a finished subagent show
    // "Subagent running / Waiting for subagent session…" until its slowest
    // sibling finished.
    running: !!result && !terminal && !backgrounded && (waitExpired || !hasResultText),
    status,
    childSessionId: details?.childSessionId ?? details?.sessionId ?? null,
    subagentName: details?.subagentName ?? null,
    waitExpired,
    backgrounded,
  };
}
