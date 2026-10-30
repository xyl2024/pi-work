import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    ModelRuntime: { create: mocks.create },
  };
});

import { POST as translatePOST } from "@/app/api/translate/route";
import { POST as autoNamePOST } from "@/app/api/sessions/[id]/auto-name/route";
import { testModelConnection } from "@/lib/server/model-connection-test";
import { cacheSessionPath } from "@/lib/server/session-reader";
import { createDirectLlmSession, directPrompt } from "@/lib/server/llm-direct";
import { runWithLlmAuditContext } from "@/lib/server/llm-audit";
import { summarize } from "@/lib/server/token-audit-store";
import { GET } from "@/app/api/token-audit/calls/route";

let dir: string;
let dbCounter = 0;
const clock = { now: 0 };
let nowSpy: MockInstance;
const originalLogFile = process.env.PI_WORK_LOG_FILE;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_WORK_LOG_FILE = "off";

function resetDbGlobals(): void {
  const g = globalThis as { __piTokenAuditDb?: { close: () => void } };
  g.__piTokenAuditDb?.close();
  delete g.__piTokenAuditDb;
}

function switchToTempDb(name = `direct-${++dbCounter}`): string {
  resetDbGlobals();
  const file = join(dir, `${name}.db`);
  process.env.PI_WORK_TOKEN_AUDIT_DB = file;
  return file;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-direct-call-metrics-"));
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
});

beforeEach(() => {
  switchToTempDb();
  delete (globalThis as { __piLlmAuditModelRuntime?: ModelRuntime }).__piLlmAuditModelRuntime;
  mocks.create.mockReset();
  clock.now = 0;
  nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock.now);
});

afterEach(() => {
  nowSpy.mockRestore();
});

afterAll(() => {
  resetDbGlobals();
  delete process.env.PI_WORK_TOKEN_AUDIT_DB;
  if (originalLogFile === undefined) delete process.env.PI_WORK_LOG_FILE;
  else process.env.PI_WORK_LOG_FILE = originalLogFile;
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(dir, { recursive: true, force: true });
});

const MODEL = {
  provider: "test-provider",
  id: "test-model",
  api: "test-api",
  name: "Test Model",
  input: ["text"],
  contextWindow: 128_000,
  maxTokens: 4_096,
  reasoning: false,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as const;

const SAMPLE = {
  firstText: "Hello",
  secondText: " world",
  outputTokens: 120,
  firstAt: 2_000,
  lastAt: 6_000,
  doneAt: 7_000,
} as const;

function usage(outputTokens: number) {
  return {
    input: 10,
    output: outputTokens,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 10 + outputTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: MODEL.api,
    provider: MODEL.provider,
    model: MODEL.id,
    usage: usage(SAMPLE.outputTokens),
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  } as AssistantMessage;
}

function textMessage(text: string, outputTokens = SAMPLE.outputTokens): AssistantMessage {
  return assistantMessage({ content: [{ type: "text", text }], usage: usage(outputTokens) });
}

function scriptedStream(
  text = `${SAMPLE.firstText}${SAMPLE.secondText}`,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  clock.now = 0;
  const firstPartial = textMessage(SAMPLE.firstText);
  const lastPartial = textMessage(text);
  queueMicrotask(() => {
    clock.now = SAMPLE.firstAt;
    stream.push({ type: "start", partial: assistantMessage({ content: [], usage: usage(0) }) } as AssistantMessageEvent);
    stream.push({ type: "text_start", contentIndex: 0, partial: assistantMessage({ content: [], usage: usage(0) }) } as AssistantMessageEvent);
    stream.push({ type: "text_delta", contentIndex: 0, delta: SAMPLE.firstText, partial: firstPartial } as AssistantMessageEvent);
    clock.now = SAMPLE.lastAt;
    stream.push({ type: "text_delta", contentIndex: 0, delta: text.slice(SAMPLE.firstText.length), partial: lastPartial } as AssistantMessageEvent);
    stream.push({ type: "text_end", contentIndex: 0, content: text, partial: lastPartial } as AssistantMessageEvent);
    clock.now = SAMPLE.doneAt;
    stream.push({ type: "done", reason: "stop", message: textMessage(text) } as AssistantMessageEvent);
  });
  return stream;
}

function scriptedRuntime(): ModelRuntime {
  const runtime = {
    stream: () => scriptedStream(),
    streamSimple: () => scriptedStream(),
    getModel: (provider: string, modelId: string) =>
      provider === MODEL.provider && modelId === MODEL.id ? MODEL : undefined,
    getPhysicalModel: (provider: string, modelId: string) =>
      provider === MODEL.provider && modelId === MODEL.id ? MODEL : undefined,
    getProviders: () => [],
    getAvailableSnapshot: () => [],
    hasConfiguredAuth: () => true,
    checkAuth: async () => true,
    isUsingOAuth: () => false,
    getAuth: async () => ({ auth: { apiKey: "test-key" }, env: {} }),
    refresh: async () => {},
    registerProvider: () => {},
    registerNativeProvider: () => {},
    registerVirtualModel: () => {},
    unregisterProvider: () => {},
    unregisterVirtualModel: () => {},
  };
  return runtime as unknown as ModelRuntime;
}

function abortAwareRuntime(): ModelRuntime {
  const runtime = scriptedRuntime() as unknown as {
    stream: () => AssistantMessageEventStream;
    streamSimple: (model: unknown, context: unknown, options?: { signal?: AbortSignal }) => AssistantMessageEventStream;
  };
  runtime.streamSimple = (_model, _context, options) => {
    const stream = createAssistantMessageEventStream();
    clock.now = 0;
    const sendError = () => {
      clock.now = 4_000;
      stream.push({
        type: "error",
        reason: "aborted",
        error: assistantMessage({ stopReason: "aborted", usage: usage(0) }),
      } as AssistantMessageEvent);
    };
    queueMicrotask(() => {
      clock.now = SAMPLE.firstAt;
      stream.push({ type: "start", partial: assistantMessage({ content: [], usage: usage(0) }) } as AssistantMessageEvent);
      stream.push({ type: "text_start", contentIndex: 0, partial: assistantMessage() } as AssistantMessageEvent);
      stream.push({ type: "text_delta", contentIndex: 0, delta: SAMPLE.firstText, partial: textMessage(SAMPLE.firstText) } as AssistantMessageEvent);
      const signal = options?.signal;
      if (signal?.aborted) sendError();
      else signal?.addEventListener("abort", sendError, { once: true });
    });
    return stream;
  };
  return runtime as unknown as ModelRuntime;
}

function neverOutputRuntime(): ModelRuntime {
  const runtime = scriptedRuntime() as unknown as {
    streamSimple: (model: unknown, context: unknown, options?: { signal?: AbortSignal }) => AssistantMessageEventStream;
  };
  runtime.streamSimple = (_model, _context, options) => {
    const stream = createAssistantMessageEventStream();
    clock.now = 0;
    const sendError = () => {
      clock.now = 5_000;
      stream.push({
        type: "error",
        reason: "aborted",
        error: assistantMessage({ stopReason: "aborted", usage: usage(0) }),
      } as AssistantMessageEvent);
    };
    if (options?.signal?.aborted) queueMicrotask(sendError);
    else options?.signal?.addEventListener("abort", sendError, { once: true });
    return stream;
  };
  return runtime as unknown as ModelRuntime;
}

interface TokenCallBody {
  callId: string;
  sessionId: string | null;
  source: string;
  purpose: string;
  status: string;
  provider: string;
  modelId: string;
  outputTokens: number | null;
  durationMs: number | null;
  ttftMs: number | null;
  generationDurationMs: number | null;
  generationTps: number | null;
  endToEndTps: number | null;
}

async function queryCalls(query = "range=all&limit=50"): Promise<{ rows: TokenCallBody[]; total: number }> {
  const response = await GET(new Request(`http://localhost/api/token-audit/calls?${query}`));
  expect(response.status).toBe(200);
  return (await response.json()) as { rows: TokenCallBody[]; total: number };
}

function expectSampleMetrics(row: TokenCallBody): void {
  expect(row).toMatchObject({
    status: "completed",
    provider: MODEL.provider,
    modelId: MODEL.id,
    outputTokens: SAMPLE.outputTokens,
    ttftMs: SAMPLE.firstAt,
    generationDurationMs: SAMPLE.lastAt - SAMPLE.firstAt,
    durationMs: SAMPLE.doneAt,
    generationTps: 30,
  });
  expect(row.endToEndTps).toBeCloseTo(120 / 7, 10);
}

describe("translate direct calls", () => {
  it("streams the original output in order and records one translation call", async () => {
    mocks.create.mockResolvedValue(scriptedRuntime());

    const response = await translatePOST(
      new Request("http://localhost/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "你好",
          target: "en",
          provider: MODEL.provider,
          modelId: MODEL.id,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    const payloads = body
      .split("\n\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice("data: ".length)) as { type: string; text?: string });

    expect(payloads.filter((p) => p.type === "delta").map((p) => p.text)).toEqual([
      SAMPLE.firstText,
      SAMPLE.secondText,
    ]);
    expect(payloads.at(-1)).toMatchObject({ type: "done", modelId: `${MODEL.provider}/${MODEL.id}` });

    const { rows, total } = await queryCalls();
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sessionId: null,
      source: "direct",
      purpose: "translation",
      api: MODEL.api,
    });
    expectSampleMetrics(rows[0]);

    expect((await queryCalls("range=all&sessionId=s1")).total).toBe(0);

    expect(summarize("all", "none").totals.calls).toBe(0);
  });
});

describe("auto-name direct calls", () => {
  it("keeps the one-shot result behaviour and records one auto-name call", async () => {
    mocks.create.mockResolvedValue(scriptedRuntime());

    const sessionId = "auto-name-session";
    const file = join(dir, `${sessionId}.jsonl`);
    writeFileSync(
      file,
      [
        JSON.stringify({ type: "message", message: { role: "user", content: "帮我重构这个模块" } }),
        JSON.stringify({
          type: "message",
          message: { role: "assistant", provider: MODEL.provider, model: MODEL.id, content: [] },
        }),
      ].join("\n") + "\n",
    );
    cacheSessionPath(sessionId, file);

    const response = await autoNamePOST(
      new Request(`http://localhost/api/sessions/${sessionId}/auto-name`, { method: "POST" }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: `${SAMPLE.firstText}${SAMPLE.secondText}` });

    const { rows, total } = await queryCalls();
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sessionId,
      source: "direct",
      purpose: "auto-name",
      api: MODEL.api,
    });
    expectSampleMetrics(rows[0]);

    const filtered = await queryCalls(`range=all&sessionId=${sessionId}`);
    expect(filtered.total).toBe(1);
    expect(filtered.rows[0].callId).toBe(rows[0].callId);
  });
});

describe("direct-call boundaries", () => {
  it("keeps the no-disk session free of tools, extensions and project context", async () => {
    mocks.create.mockResolvedValue(scriptedRuntime());
    const session = await createDirectLlmSession(MODEL.provider, MODEL.id, "system prompt", "off");
    try {
      expect(session.getActiveToolNames()).toEqual([]);
      expect(session.resourceLoader.getExtensions().extensions).toEqual([]);
      expect(session.resourceLoader.getSkills().skills).toEqual([]);
      expect(session.resourceLoader.getPrompts().prompts).toEqual([]);
      expect(session.resourceLoader.getAgentsFiles().agentsFiles).toEqual([]);
      expect(session.resourceLoader.getSystemPrompt()).toBe("system prompt");
      expect(session.resourceLoader.getAppendSystemPrompt()).toEqual([]);
    } finally {
      session.dispose();
    }
    expect((await queryCalls()).total).toBe(0);
  });

  it("records a cancelled translate call with its measured TTFT and no throughput", async () => {
    mocks.create.mockResolvedValue(abortAwareRuntime());
    const controller = new AbortController();
    const response = await translatePOST(
      new Request("http://localhost/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "你好",
          target: "en",
          provider: MODEL.provider,
          modelId: MODEL.id,
        }),
        signal: controller.signal,
      }),
    );
    expect(response.status).toBe(200);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";
    const pump = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) return;
          body += decoder.decode(value);
          if (body.includes('"delta"')) controller.abort();
        }
      } catch {
      }
    })();
    await vi.waitFor(() => expect(controller.signal.aborted).toBe(true), { timeout: 2_000 });
    await vi.waitFor(async () => expect((await queryCalls()).total).toBe(1), { timeout: 2_000 });
    await reader.cancel().catch(() => {});
    await pump;

    const { rows, total } = await queryCalls();
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({
      purpose: "translation",
      status: "cancelled",
      ttftMs: SAMPLE.firstAt,
      generationDurationMs: 0,
      generationTps: null,
      endToEndTps: null,
    });
  });

  it("times out a one-shot auto-name call as cancelled without fabricating metrics", async () => {
    mocks.create.mockResolvedValue(neverOutputRuntime());
    await expect(
      runWithLlmAuditContext(
        { sessionId: "timeout-session", source: "direct", purpose: "auto-name", cwd: null, sessionName: null },
        () =>
          directPrompt("hello", {
            systemPrompt: "system prompt",
            provider: MODEL.provider,
            modelId: MODEL.id,
            timeoutMs: 20,
          }),
      ),
    ).rejects.toThrow(/timed out/);

    const { rows, total } = await queryCalls();
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({
      sessionId: "timeout-session",
      purpose: "auto-name",
      status: "cancelled",
      ttftMs: null,
      generationDurationMs: null,
      generationTps: null,
      endToEndTps: null,
    });
  });

  it("does not record the model connection test as a business call", async () => {
    mocks.create.mockResolvedValue(scriptedRuntime());

    const result = await testModelConnection(MODEL.provider, MODEL.id, new AbortController().signal);
    expect(result.ok).toBe(true);

    expect((await queryCalls()).total).toBe(0);
  });
});
