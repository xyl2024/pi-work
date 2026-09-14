import { describe, expect, it } from "vitest";
import { deriveSubagentBlockState } from "@/lib/shared/subagent-block-state";
import type { ToolResultMessage } from "@/lib/shared/types";

/**
 * A spawn_subagent tool result. `details` mirrors what the tool puts on it
 * (`lib/server/subagent-tool.ts`): `status` is `"running"` only on the
 * in-flight partials pushed through `tool_execution_update`; the final result
 * carries `completed` / `failed` / `cancelled` plus the result text.
 */
function result(overrides: Partial<ToolResultMessage> = {}): ToolResultMessage {
  return { role: "toolResult", toolCallId: "call_1", toolName: "spawn_subagent", content: [], ...overrides };
}

const text = (value: string) => [{ type: "text" as const, text: value }];

describe("deriveSubagentBlockState", () => {
  it("keeps the live panel up while the child session is running", () => {
    const state = deriveSubagentBlockState({
      result: result({ details: { status: "running", sessionId: "child-1" } }),
      isError: false,
    });
    expect(state).toEqual({ running: true, childSessionId: "child-1" });
  });

  it("shows the waiting state before the child session exists (queued call)", () => {
    // tool_execution_start created the in-flight entry; no onSession partial yet.
    const state = deriveSubagentBlockState({ result: result(), isError: false });
    expect(state).toEqual({ running: true, childSessionId: null });
  });

  it("stops claiming a run while pi has not delivered the batch's toolResult yet", () => {
    // A parallel tool batch: pi emits this tool's `tool_execution_end` as soon
    // as it finishes (dropping the in-flight partial) but only emits the batch's
    // toolResult messages once EVERY tool in it has finished. In between, the
    // block has no result at all — it must not render the live panel (and its
    // "Waiting for subagent session…" body) for an already-finished child.
    const state = deriveSubagentBlockState({ result: undefined, isError: false });
    expect(state).toEqual({ running: false, childSessionId: null });
  });

  it("shows the final result once it lands instead of the live panel", () => {
    const state = deriveSubagentBlockState({
      result: result({ content: text("Subagent completed (child-1).\n\nDone."), details: { status: "completed", sessionId: "child-1" } }),
      isError: false,
    });
    expect(state).toEqual({ running: false, childSessionId: "child-1" });
  });

  it("ends the panel on a cancelled or failed child even without result text", () => {
    for (const status of ["cancelled", "failed"] as const) {
      const state = deriveSubagentBlockState({
        result: result({ content: text("Subagent " + status + " (subagent:x)."), details: { status, sessionId: "child-1" } }),
        isError: false,
      });
      expect(state.running).toBe(false);
    }
  });

  it("ends the panel when the tool call itself errored", () => {
    const state = deriveSubagentBlockState({
      result: result({ details: { status: "running", sessionId: "child-1" } }),
      isError: true,
    });
    expect(state.running).toBe(false);
  });
});
