// ============================================================================
// spawn_subagent ToolCallBlock state (pure)
//
// The block renders one of three things: the live child-activity panel (while
// the child run is in flight), the tool's final result, or — in the window
// where neither exists yet — just the call's own input.
//
// Which one it is comes from the result object the block was handed, which is
// either the tool's final `ToolResultMessage` (persisted by pi, or streamed
// when the tool ends) or the in-flight partial the client keeps from
// `tool_execution_update` (created on `tool_execution_start`, dropped on
// `tool_execution_end`). See `hooks/useAgentSession/events.ts`.
//
// Like `chat-timeline` / `scroll-follow` this module may not import React, the
// DOM, a client hook, or anything from `lib/server`.
// ============================================================================

import type { ToolResultMessage } from "./types";

/** The subagent live/terminal states the tool result's details carry. */
export type SubagentBlockStatus = "running" | "completed" | "failed" | "cancelled";

export interface SubagentBlockState {
  /** True while the child run is in flight: the block shows the live panel. */
  running: boolean;
  /**
   * Child session whose activity the live panel polls. Null until the child
   * session exists (the call can be waiting for a free concurrency slot) and
   * whenever the block knows of no child at all.
   */
  childSessionId: string | null;
}

export interface SubagentBlockStateInput {
  /** The block's result: final tool result, else the in-flight partial, else undefined. */
  result: ToolResultMessage | undefined;
  /** Whether the tool call itself failed (a tool-level error, not a child status). */
  isError: boolean;
}

/** Details payload `spawn_subagent` puts on its result (see `lib/server/subagent-tool.ts`). */
interface SpawnSubagentResultDetails {
  status?: SubagentBlockStatus;
  sessionId?: string | null;
}

export function deriveSubagentBlockState({ result, isError }: SubagentBlockStateInput): SubagentBlockState {
  const details = (result?.details ?? null) as SpawnSubagentResultDetails | null;
  const hasResultText = !!result && result.content.some((item) => item.type === "text" && item.text.trim().length > 0);
  const terminal = details?.status === "completed" || details?.status === "failed" || details?.status === "cancelled" || isError;
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
    running: !!result && !hasResultText && !terminal,
    childSessionId: details?.sessionId ?? null,
  };
}
