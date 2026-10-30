import { describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { wrapModelCallMetrics } from "@/lib/server/model-call-metrics";
import type { ModelCallInsert } from "@/lib/shared/token-audit-types";

const MODEL = { provider: "test-provider", id: "test-model", api: "test-api" } as const;

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "test-api",
    provider: "test-provider",
    model: "test-model",
    stopReason: "stop",
    timestamp: 1_700_000_000_000,
    ...overrides,
  } as AssistantMessage;
}

function manualRuntime(): { runtime: ModelRuntime; streams: AssistantMessageEventStream[] } {
  const streams: AssistantMessageEventStream[] = [];
  const make = () => {
    const stream = createAssistantMessageEventStream();
    streams.push(stream);
    return stream;
  };
  const runtime = { stream: make, streamSimple: make, getProviders: () => [] };
  return { runtime: runtime as unknown as ModelRuntime, streams };
}

function harness() {
  const manual = manualRuntime();
  const published: Array<string | null> = [];
  const recorded: ModelCallInsert[] = [];
  const runtime = wrapModelCallMetrics(manual.runtime, {
    record: (input) => recorded.push(input),
    bindCallId: (callId) => published.push(callId),
  });
  return { runtime, manual, published, recorded };
}

const EMPTY_CONTEXT = { messages: [] };

describe("model call id binding", () => {
  it("publishes the in-flight call id and clears it when the call completes", () => {
    const { runtime, published, recorded } = harness();

    const stream = runtime.streamSimple(MODEL as never, EMPTY_CONTEXT, {});
    expect(published).toHaveLength(1);
    expect(published[0]).toBeTruthy();

    stream.push({ type: "done", reason: "stop", message: assistantMessage() } as AssistantMessageEvent);

    expect(published).toEqual([published[0], null]);
    expect(recorded.map((row) => row.callId)).toEqual([published[0]]);
  });

  it("clears the id when the call fails", () => {
    const { runtime, published } = harness();

    const stream = runtime.streamSimple(MODEL as never, EMPTY_CONTEXT, {});
    stream.push({
      type: "error",
      reason: "error",
      error: assistantMessage({ stopReason: "error" }),
    } as AssistantMessageEvent);

    expect(published[1]).toBeNull();
  });

  it("clears the id when the runtime throws before returning a stream", () => {
    const published: Array<string | null> = [];
    const runtime = {
      streamSimple: () => {
        throw new Error("provider exploded");
      },
      stream: () => {
        throw new Error("provider exploded");
      },
      getProviders: () => [],
    } as unknown as ModelRuntime;

    const wrapped = wrapModelCallMetrics(runtime, {
      record: () => {},
      bindCallId: (callId) => published.push(callId),
    });

    expect(() => wrapped.streamSimple(MODEL as never, EMPTY_CONTEXT, {})).toThrow("provider exploded");
    expect(published).toHaveLength(2);
    expect(published[0]).toBeTruthy();
    expect(published[1]).toBeNull();
  });
});
