import { describe, expect, it } from "vitest";
import {
  CLIENT_SESSION_INPUT_TYPES,
  SESSION_EVENT_TYPES,
  isClientSessionInput,
  reduceSessionInput,
} from "@/lib/shared/session-events";
import type { SessionRuntimeInput } from "@/lib/shared/session-events";
import {
  createSessionRuntimeState,
  patchSessionRuntimeState,
  type SessionRuntimeState,
} from "@/lib/shared/session-runtime-state";
import type { AgentMessage } from "@/lib/shared/types";

// Pure unit tests for the client half of the reducer's input union (#74). The
// REST snapshot used to be a second writer of the runtime state and the phase
// had a second concurrent derivation; these tests pin the two properties that
// moving it into the one reducer is for:
//
//   • the snapshot reduces like any other input — including today's "running"
//     derivation (compaction wins, unknown phase waits on the model, a `true`
//     `running` flag with no `state` counts);
//   • replaying the same snapshot is idempotent, which is what makes SSE
//     reconnects, compaction replays and window refocus safe.

const eventTypes: readonly string[] = SESSION_EVENT_TYPES;

const snapshot = (
  value: SessionRuntimeState,
  payload: Parameters<typeof reduceSessionInput>[1],
) => reduceSessionInput(value, payload);

describe("client session inputs", () => {
  it("keeps client input names disjoint from the wire protocol", () => {
    expect(CLIENT_SESSION_INPUT_TYPES.length).toBeGreaterThan(0);
    expect(CLIENT_SESSION_INPUT_TYPES.filter((type) => eventTypes.includes(type))).toEqual([]);
  });

  it("classifies a client input apart from a wire event", () => {
    const wire: SessionRuntimeInput = { type: "agent_start" };
    const client: SessionRuntimeInput = { type: "client_snapshot", snapshot: null };
    expect(isClientSessionInput(client)).toBe(true);
    expect(isClientSessionInput(wire)).toBe(false);
  });
});

describe("client snapshot input", () => {
  it("adopts the snapshot's usage and composition", () => {
    const usage = { percent: 10, contextWindow: 200_000, tokens: 20_000 };
    const next = snapshot(createSessionRuntimeState(), {
      type: "client_snapshot",
      snapshot: { running: false, state: { contextUsage: usage, contextComposition: null } },
    });
    expect(next.state.contextUsage).toEqual(usage);
    expect(next.state.contextComposition).toBeNull();
  });

  it("returns the system prompt and tool selection as effects, not state", () => {
    const next = snapshot(createSessionRuntimeState(), {
      type: "client_snapshot",
      snapshot: { running: false, state: { systemPrompt: "sys", toolNames: ["bash"] } },
    });
    expect(next.effects).toEqual([
      { kind: "adopt_system_prompt", value: "sys" },
      { kind: "adopt_tool_selection", selection: ["bash"] },
      { kind: "end_streaming_view" },
    ]);
  });

  it("moves a running state to idle and asks for the streaming view to close", () => {
    const running = patchSessionRuntimeState(createSessionRuntimeState(), "agentRunning", true);
    const next = snapshot(running, { type: "client_snapshot", snapshot: { running: false } });
    expect(next.state.agentRunning).toBe(false);
    expect(next.state.isCompacting).toBe(false);
    expect(next.state.agentPhase).toBeNull();
    expect(next.effects).toContainEqual({ kind: "end_streaming_view" });
  });

  it("raises the phase from a running snapshot with no state", () => {
    const next = snapshot(createSessionRuntimeState(), {
      type: "client_snapshot",
      snapshot: { running: true },
    });
    expect(next.state.agentRunning).toBe(true);
    expect(next.state.isCompacting).toBe(false);
    expect(next.state.agentPhase).toEqual({ kind: "waiting_model" });
  });

  it("lets compaction win over a running snapshot", () => {
    const next = snapshot(createSessionRuntimeState(), {
      type: "client_snapshot",
      snapshot: { running: true, state: { isRunning: true, phase: "compacting" } },
    });
    expect(next.state.isCompacting).toBe(true);
    expect(next.state.agentPhase).toEqual({ kind: "compacting" });
  });

  it("shows the executing tool when the transcript has one in flight", () => {
    const assistant: AgentMessage = {
      role: "assistant",
      model: "m",
      provider: "p",
      content: [{ type: "toolCall", toolCallId: "call-1", toolName: "bash", input: { command: "ls" } }],
    };
    const state = patchSessionRuntimeState(
      createSessionRuntimeState(),
      "messages",
      [{ role: "user", content: "go" } satisfies AgentMessage, assistant],
    );
    const next = snapshot(state, {
      type: "client_snapshot",
      snapshot: { running: true, state: { isRunning: true } },
    });
    expect(next.state.agentPhase).toEqual({
      kind: "running_tools",
      tools: [{ id: "call-1", name: "bash", args: { command: "ls" } }],
    });
  });

  it("is idempotent: the same snapshot twice changes neither state nor effects", () => {
    // The running branch is the interesting one: it re-derives the phase, and a
    // fresh but equal phase object must not churn the state identity.
    const input: SessionRuntimeInput = {
      type: "client_snapshot",
      snapshot: { running: true, state: { isRunning: true } },
    };
    const first = snapshot(createSessionRuntimeState(), input);
    const second = snapshot(first.state, input);
    expect(second.state).toBe(first.state);
    expect(second.effects).toEqual(first.effects);
  });

  it("is idempotent on an idle snapshot too", () => {
    const input: SessionRuntimeInput = { type: "client_snapshot", snapshot: { running: false } };
    const first = snapshot(createSessionRuntimeState(), input);
    const second = snapshot(first.state, input);
    expect(second.state).toBe(first.state);
    expect(second.effects).toEqual(first.effects);
  });
});
