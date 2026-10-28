import { describe, expect, it } from "vitest";
import { deriveSubagentBlockState } from "@/lib/shared/subagent-block-state";
import type { ToolResultMessage } from "@/lib/shared/types";

/**
 * A subagent tool result. `details` mirrors what the tool puts on it
 * (`lib/server/subagent-tool.ts`): non-terminal statuses (`queued`, `creating`,
 * `running`, `stopping`) appear on in-flight partials and on a final result
 * whose wait expired; terminal statuses replace the live panel.
 */
function result(overrides: Partial<ToolResultMessage> = {}): ToolResultMessage {
  return { role: "toolResult", toolCallId: "call_1", toolName: "subagent", content: [], ...overrides };
}

const text = (value: string) => [{ type: "text" as const, text: value }];

describe("deriveSubagentBlockState", () => {
  it("keeps the live panel up while the child task is running", () => {
    const state = deriveSubagentBlockState({
      result: result({ details: { status: "running", childSessionId: "child-1" } }),
      isError: false,
    });
    expect(state).toMatchObject({ running: true, status: "running", childSessionId: "child-1", subagentName: null, waitExpired: false });
  });

  it("shows the waiting state before the child session exists (queued task)", () => {
    // tool_execution_start created the in-flight entry; no onSession partial yet.
    const state = deriveSubagentBlockState({ result: result(), isError: false });
    expect(state).toMatchObject({ running: true, status: null, childSessionId: null, subagentName: null });
  });

  it("keeps the panel up when the tool returned because its wait expired", () => {
    // The task outlives the tool call: the result carries text (so the block
    // must also show that text) but the task is still unfinished.
    const state = deriveSubagentBlockState({
      result: result({
        content: text("Subagent is still running after 900s (task subagent:1, session child-1)."),
        details: { status: "running", childSessionId: "child-1", waitExpired: true },
      }),
      isError: false,
    });
    expect(state).toMatchObject({ running: true, status: "running", childSessionId: "child-1", waitExpired: true });
  });

  it("stops claiming a run while pi has not delivered the batch's toolResult yet", () => {
    // A parallel tool batch: pi emits this tool's `tool_execution_end` as soon
    // as it finishes (dropping the in-flight partial) but only emits the batch's
    // toolResult messages once EVERY tool in it has finished. In between, the
    // block has no result at all — it must not render the live panel (and its
    // "Waiting for subagent session…" body) for an already-finished child.
    const state = deriveSubagentBlockState({ result: undefined, isError: false });
    expect(state.running).toBe(false);
  });

  it("shows the final result once it lands instead of the live panel", () => {
    const state = deriveSubagentBlockState({
      result: result({ content: text("Subagent completed (child-1).\n\nDone."), details: { status: "completed", childSessionId: "child-1", subagentName: "codebase_explorer" } }),
      isError: false,
    });
    expect(state).toMatchObject({ running: false, status: "completed", childSessionId: "child-1", subagentName: "codebase_explorer" });
  });

  it("ends the panel on a terminal status even without result text", () => {
    for (const status of ["cancelled", "failed", "interrupted"] as const) {
      const state = deriveSubagentBlockState({
        result: result({ content: text("Subagent " + status + " (task subagent:x)."), details: { status, childSessionId: "child-1" } }),
        isError: false,
      });
      expect(state.running).toBe(false);
    }
  });

  it("ends the panel when the tool call itself errored", () => {
    const state = deriveSubagentBlockState({
      result: result({ details: { status: "running", childSessionId: "child-1" } }),
      isError: true,
    });
    expect(state.running).toBe(false);
  });

  it("keeps rendering old spawn_subagent results (legacy sessionId field)", () => {
    const state = deriveSubagentBlockState({
      result: result({ toolName: "spawn_subagent", details: { status: "running", sessionId: "child-9" } }),
      isError: false,
    });
    expect(state).toMatchObject({ running: true, childSessionId: "child-9" });
  });
});
