import { describe, expect, it } from "vitest";
import {
  createSeenLedger,
  createSessionRuntimeState,
  inFlightToolResultsOf,
  patchSessionRuntimeState,
  removeInFlightTool,
  upsertInFlightTool,
} from "@/lib/shared/session-runtime-state";
import type { InFlightToolCall } from "@/lib/shared/session-runtime-state";

// Pure unit tests for the session runtime state (#59). The state used to live
// as eleven useState calls and six refs inside `useAgentSession`, and one of
// its dedupe ledgers was a module-level `Set` shared across every session.
// These tests pin the two properties that move was for:
//
//   • ledgers are per-session — the same tool-call id in two sessions must not
//     let one suppress the other's reaction;
//   • the state shape is a single object with identity-preserving patches, so
//     a no-op write does not churn consumers.

describe("session runtime state", () => {
  it("gives every session its own in-flight tool table", () => {
    const a = createSessionRuntimeState();
    const b = createSessionRuntimeState();

    a.inFlightTools.set("call-1", { name: "bash", args: { command: "git status" } });

    expect(a.inFlightTools.has("call-1")).toBe(true);
    expect(b.inFlightTools.has("call-1")).toBe(false);
  });

  it("isolates the dedupe ledgers per session", () => {
    const a = createSessionRuntimeState();
    const b = createSessionRuntimeState();

    // Same tool-call id claimed in session A …
    expect(a.seenCelebrateToolEndIds.claim("celebrate-1")).toBe(true);
    expect(a.seenSubagentToolCallIds.claim("spawn-1")).toBe(true);
    expect(a.seenSubagentToolStartIds.claim("spawn-1")).toBe(true);
    expect(a.seenSubagentToolEndIds.claim("spawn-1")).toBe(true);

    // … must not be remembered in session B: the ledger is state, not module scope.
    expect(b.seenCelebrateToolEndIds.has("celebrate-1")).toBe(false);
    expect(b.seenSubagentToolCallIds.has("spawn-1")).toBe(false);
    expect(b.seenSubagentToolStartIds.has("spawn-1")).toBe(false);
    expect(b.seenSubagentToolEndIds.has("spawn-1")).toBe(false);
    expect(b.seenCelebrateToolEndIds.claim("celebrate-1")).toBe(true);
    expect(b.seenSubagentToolCallIds.claim("spawn-1")).toBe(true);
  });

  it("does not let one session's ledger clear another's", () => {
    const a = createSessionRuntimeState();
    const b = createSessionRuntimeState();

    a.seenCelebrateToolEndIds.claim("shared-id");
    b.seenCelebrateToolEndIds.clear();

    expect(a.seenCelebrateToolEndIds.has("shared-id")).toBe(true);
  });

  it("claims an id exactly once within one ledger", () => {
    const ledger = createSeenLedger();
    expect(ledger.claim("id")).toBe(true);
    expect(ledger.claim("id")).toBe(false);
    expect(ledger.claim("id")).toBe(false);
    expect(ledger.has("id")).toBe(true);
    ledger.clear();
    expect(ledger.has("id")).toBe(false);
    expect(ledger.claim("id")).toBe(true);
  });

  it("returns the same state object when a patch resolves to the same value", () => {
    const state = createSessionRuntimeState();
    expect(patchSessionRuntimeState(state, "agentRunning", false)).toBe(state);
    expect(patchSessionRuntimeState(state, "messages", (previous) => previous)).toBe(state);
  });

  it("returns a new object when a patch changes a field", () => {
    const state = createSessionRuntimeState();
    const next = patchSessionRuntimeState(state, "agentRunning", true);
    expect(next).not.toBe(state);
    expect(next.agentRunning).toBe(true);
    expect(state.agentRunning).toBe(false);
    // Untouched fields (including the ledgers) are carried over by reference.
    expect(next.seenCelebrateToolEndIds).toBe(state.seenCelebrateToolEndIds);
    expect(next.inFlightTools).toBe(state.inFlightTools);
  });

  it("derives in-flight tool results from the single tool table", () => {
    const state = createSessionRuntimeState();
    const inFlight: InFlightToolCall = {
      name: "bash",
      args: { command: "ls" },
      result: { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [], timestamp: 1 },
    };
    const withTool = patchSessionRuntimeState(state, "inFlightTools", new Map([["call-1", inFlight]]));

    const results = inFlightToolResultsOf(withTool.inFlightTools);
    expect(results.get("call-1")).toBe(inFlight.result);
  });

  it("omits in-flight tool calls that have no result yet", () => {
    const state = createSessionRuntimeState();
    const noResult = patchSessionRuntimeState(
      state,
      "inFlightTools",
      new Map([["call-1", { name: "bash", args: {} } satisfies InFlightToolCall]]),
    );
    expect(inFlightToolResultsOf(noResult.inFlightTools).size).toBe(0);
  });

  it("records a started tool call with name, args and an empty result", () => {
    const tools = upsertInFlightTool(new Map(), "call-1", "bash", { command: "git status" });
    const entry = tools.get("call-1");
    expect(entry?.name).toBe("bash");
    expect(entry?.args).toEqual({ command: "git status" });
    expect(entry?.result).toMatchObject({ role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [] });
  });

  it("keeps the accumulated result when a start is replayed", () => {
    // SSE reconnects can replay tool_execution_start for a call already in
    // flight; that must not wipe the streaming output that already arrived.
    const started = upsertInFlightTool(new Map(), "call-1", "bash", { command: "ls" });
    const withStreamingOutput = new Map(started);
    withStreamingOutput.set("call-1", {
      ...started.get("call-1")!,
      result: { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "partial" }], timestamp: 1 },
    });

    const replayed = upsertInFlightTool(withStreamingOutput, "call-1", "bash", { command: "ls" });
    expect(replayed.get("call-1")?.result?.content).toEqual([{ type: "text", text: "partial" }]);
  });

  it("returns the same map when ending a call that is not in flight", () => {
    const tools = new Map([["call-1", { name: "bash", args: {} } satisfies InFlightToolCall]]);
    expect(removeInFlightTool(tools, "call-2")).toBe(tools);
    const removed = removeInFlightTool(tools, "call-1");
    expect(removed).not.toBe(tools);
    expect(removed.has("call-1")).toBe(false);
  });
});
