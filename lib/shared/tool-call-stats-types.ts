/**
 * The tool-lifecycle reports the session reducer asks for, without a clock.
 *
 * The reducer decides *that* a tool started or ended (it is the only thing
 * that sees the in-flight tool table and the tool result), but reading the
 * wall clock is I/O, so `timestamp` is deliberately absent here: the client
 * adapter stamps `Date.now()` when it hands the report to the tool-call stats
 * store. `hooks/ToolCallStatsContext.tsx` derives its event types from these,
 * so the two sides cannot drift.
 */

/** One `tool_execution_start`. */
export interface ToolCallStartReport {
  type: "tool_start";
  toolCallId: string;
  toolName: string;
  /** Raw tool arguments (e.g. `{ command: "git status" }` for bash). */
  args?: Record<string, unknown>;
}

/** One `tool_execution_end`. */
export interface ToolCallEndReport {
  type: "tool_end";
  toolCallId: string;
  isError: boolean;
  /** First text block of the tool result, truncated to ~1KB. Used to extract
   *  exit codes for bash ("Command exited with code N") and to show error
   *  context in the bash command list. */
  resultText?: string;
  /** Tool-specific details payload (bash truncation info, etc.). */
  resultDetails?: unknown;
}

export type ToolCallReport = ToolCallStartReport | ToolCallEndReport;
