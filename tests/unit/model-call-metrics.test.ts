import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { wrapModelCallMetrics } from "@/lib/server/model-call-metrics";
import { getAuditModelRuntime, resolveModelCallContext, runWithLlmAuditContext } from "@/lib/server/llm-audit";
import { recordCall, recordModelCall, summarize } from "@/lib/server/token-audit-store";
import { GET } from "@/app/api/token-audit/calls/route";

/**
 * Acceptance boundary for issue 01: a controlled model runtime drives the
 * real wrapper, facts land in a real temporary SQLite database, and the real
 * per-call route handler returns them. No provider, key or user directory is
 * touched; the isolated dev instance is not started for this file.
 */

let dir: string;
let dbCounter = 0;

function resetDbGlobals(): void {
  const g = globalThis as { __piTokenAuditDb?: { close: () => void } };
  g.__piTokenAuditDb?.close();
  delete g.__piTokenAuditDb;
}

function switchToTempDb(name = `metrics-${++dbCounter}`): string {
  resetDbGlobals();
  const file = join(dir, `${name}.db`);
  process.env.PI_WORK_TOKEN_AUDIT_DB = file;
  return file;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-model-call-metrics-"));
});

beforeEach(() => {
  switchToTempDb();
});

afterAll(() => {
  resetDbGlobals();
  delete process.env.PI_WORK_TOKEN_AUDIT_DB;
  rmSync(dir, { recursive: true, force: true });
});

// ── fixtures ──────────────────────────────────────────────────────────────

const MODEL = { provider: "test-provider", id: "test-model", api: "test-api" } as const;

function usage(output: number, input = 10) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "test-api",
    provider: "test-provider",
    model: "test-model",
    usage: usage(120),
    stopReason: "stop",
    timestamp: 1_700_000_000_000,
    ...overrides,
  } as AssistantMessage;
}

function delta(type: "text_delta" | "thinking_delta" | "toolcall_delta", value: string): AssistantMessageEvent {
  return { type, contentIndex: 0, delta: value, partial: assistantMessage() } as AssistantMessageEvent;
}

function done(message: AssistantMessage): AssistantMessageEvent {
  return { type: "done", reason: "stop", message } as AssistantMessageEvent;
}

function errored(message: AssistantMessage, reason: "error" | "aborted" = "error"): AssistantMessageEvent {
  return { type: "error", reason, error: message } as AssistantMessageEvent;
}

interface ManualRuntime {
  runtime: ModelRuntime;
  streams: AssistantMessageEventStream[];
}

function manualRuntime(): ManualRuntime {
  const streams: AssistantMessageEventStream[] = [];
  const make = () => {
    const stream = createAssistantMessageEventStream();
    streams.push(stream);
    return stream;
  };
  const runtime = {
    stream: make,
    streamSimple: make,
    getProviders: () => [],
  };
  return { runtime: runtime as unknown as ModelRuntime, streams };
}

function fakeClock(startMonotonic = 0, startWall = 1_700_000_000_000) {
  let monotonic = startMonotonic;
  let wall = startWall;
  return {
    clock: { now: () => monotonic, wallNow: () => wall },
    advance(ms: number) {
      monotonic += ms;
      wall += ms;
    },
  };
}

function metricsRuntime(clock: { now: () => number; wallNow: () => number }): ManualRuntime {
  const manual = manualRuntime();
  const wrapped = wrapModelCallMetrics(manual.runtime, {
    clock,
    resolveContext: resolveModelCallContext,
    record: recordModelCall,
  });
  return { runtime: wrapped, streams: manual.streams };
}

async function queryCalls(query = "range=all&limit=50"): Promise<{ rows: TokenCallBody[]; total: number }> {
  const response = await GET(new Request(`http://localhost/api/token-audit/calls?${query}`));
  expect(response.status).toBe(200);
  return (await response.json()) as { rows: TokenCallBody[]; total: number };
}

interface TokenCallBody {
  callId: string;
  ts: number;
  sessionId: string | null;
  source: string;
  purpose: string;
  status: string;
  provider: string;
  modelId: string;
  api: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costTotal: number | null;
  durationMs: number | null;
  ttftMs: number | null;
  generationDurationMs: number | null;
  generationTps: number | null;
  endToEndTps: number | null;
}

const USER_CONTEXT = { sessionId: "s1", source: "user" as const, cwd: "/tmp", sessionName: null };

// ── deterministic formula sample ──────────────────────────────────────────

describe("logical model call metrics", () => {
  it("derives TTFT, generation window and both TPS values (0/2000/6000/7000, 120 tokens)", async () => {
    const c = fakeClock();
    const { runtime, streams } = metricsRuntime(c.clock);

    await runWithLlmAuditContext(USER_CONTEXT, async () => {
      const stream = runtime.streamSimple(MODEL as never, { messages: [] }, {});
      stream.push({ type: "start", partial: assistantMessage() } as AssistantMessageEvent);
      stream.push({ type: "text_start", contentIndex: 0, partial: assistantMessage() } as AssistantMessageEvent);
      c.advance(2000);
      stream.push(delta("text_delta", "hello"));
      c.advance(4000);
      stream.push(delta("text_delta", " world"));
      c.advance(1000);
      stream.push(done(assistantMessage()));
      await stream.result();
    });

    expect(streams).toHaveLength(1);
    const { rows, total } = await queryCalls();
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    const call = rows[0];
    expect(call.callId).toBeTruthy();
    expect(call.status).toBe("completed");
    expect(call.source).toBe("user");
    expect(call.purpose).toBe("chat");
    expect(call.sessionId).toBe("s1");
    expect(call.provider).toBe("test-provider");
    expect(call.modelId).toBe("test-model");
    expect(call.api).toBe("test-api");
    expect(call.outputTokens).toBe(120);
    expect(call.ttftMs).toBe(2000);
    expect(call.generationDurationMs).toBe(4000);
    expect(call.generationTps).toBe(30);
    expect(call.endToEndTps).toBeCloseTo(120 / 7, 10);
    // The 1,000 ms tail after the last output is not part of the window.
    expect(call.durationMs).toBe(7000);
  });

  it("treats thinking and tool-argument deltas as effective output and ignores empty/declaration events", async () => {
    for (const firstType of ["thinking_delta", "toolcall_delta"] as const) {
      switchToTempDb();
      const c = fakeClock();
      const { runtime } = metricsRuntime(c.clock);
      await runWithLlmAuditContext(USER_CONTEXT, async () => {
        const stream = runtime.streamSimple(MODEL as never, { messages: [] }, {});
        stream.push({ type: "thinking_start", contentIndex: 0, partial: assistantMessage() } as AssistantMessageEvent);
        stream.push({ type: "toolcall_start", contentIndex: 0, partial: assistantMessage() } as AssistantMessageEvent);
        stream.push(delta("text_delta", ""));
        stream.push(delta("thinking_delta", ""));
        stream.push(delta("toolcall_delta", ""));
        c.advance(1500);
        stream.push(delta(firstType, firstType === "toolcall_delta" ? "{" : "think"));
        c.advance(500);
        // A single space is still real output; we never trim.
        stream.push(delta("text_delta", " "));
        stream.push(done(assistantMessage()));
        await stream.result();
      });
      const { rows } = await queryCalls();
      expect(rows).toHaveLength(1);
      expect(rows[0].ttftMs).toBe(1500);
      expect(rows[0].generationDurationMs).toBe(500);
    }
  });

  it("returns a zero generation window (and null generation TPS) for a single output chunk", async () => {
    const c = fakeClock();
    const { runtime } = metricsRuntime(c.clock);
    await runWithLlmAuditContext(USER_CONTEXT, async () => {
      const stream = runtime.streamSimple(MODEL as never, { messages: [] }, {});
      c.advance(2000);
      stream.push(delta("text_delta", "all at once"));
      c.advance(5000);
      stream.push(done(assistantMessage()));
      await stream.result();
    });
    const { rows } = await queryCalls();
    expect(rows[0].ttftMs).toBe(2000);
    expect(rows[0].generationDurationMs).toBe(0);
    expect(rows[0].generationTps).toBeNull();
    expect(rows[0].endToEndTps).toBeCloseTo(120 / 7, 10);
  });

  it("keeps end-to-end TPS without effective output, and nulls everything when usage was never reported", async () => {
    {
      const c = fakeClock();
      const { runtime } = metricsRuntime(c.clock);
      await runWithLlmAuditContext(USER_CONTEXT, async () => {
        const stream = runtime.streamSimple(MODEL as never, { messages: [] }, {});
        c.advance(7000);
        stream.push(done(assistantMessage()));
        await stream.result();
      });
      const { rows } = await queryCalls();
      expect(rows[0].ttftMs).toBeNull();
      expect(rows[0].generationDurationMs).toBeNull();
      expect(rows[0].generationTps).toBeNull();
      expect(rows[0].outputTokens).toBe(120);
      expect(rows[0].endToEndTps).toBeCloseTo(120 / 7, 10);
    }
    {
      switchToTempDb();
      const c = fakeClock();
      const { runtime } = metricsRuntime(c.clock);
      await runWithLlmAuditContext(USER_CONTEXT, async () => {
        const stream = runtime.streamSimple(MODEL as never, { messages: [] }, {});
        // SDK placeholder usage: all zero → treated as "not reported".
        stream.push(delta("text_delta", "hi"));
        c.advance(1000);
        stream.push(done(assistantMessage({ usage: usage(0, 0) })));
        await stream.result();
      });
      const { rows } = await queryCalls();
      expect(rows[0].outputTokens).toBeNull();
      expect(rows[0].generationTps).toBeNull();
      expect(rows[0].endToEndTps).toBeNull();
    }
  });

  it("distinguishes a provider-reported zero output from missing usage", async () => {
    const c = fakeClock();
    const { runtime } = metricsRuntime(c.clock);
    await runWithLlmAuditContext(USER_CONTEXT, async () => {
      const stream = runtime.streamSimple(MODEL as never, { messages: [] }, {});
      stream.push(delta("text_delta", "a"));
      c.advance(1000);
      stream.push(delta("text_delta", "b"));
      c.advance(1000);
      stream.push(done(assistantMessage({ usage: usage(0, 25) })));
      await stream.result();
    });
    const { rows } = await queryCalls();
    expect(rows[0].outputTokens).toBe(0);
    expect(rows[0].generationTps).toBe(0);
    expect(rows[0].endToEndTps).toBe(0);
  });

  it("records failures and cancellations with TTFT but without throughput", async () => {
    for (const [reason, status] of [["error", "failed"], ["aborted", "cancelled"]] as const) {
      switchToTempDb();
      const c = fakeClock();
      const { runtime } = metricsRuntime(c.clock);
      await runWithLlmAuditContext(USER_CONTEXT, async () => {
        const stream = runtime.streamSimple(MODEL as never, { messages: [] }, {});
        c.advance(1000);
        stream.push(delta("text_delta", "partial"));
        c.advance(500);
        stream.push(errored(assistantMessage({ stopReason: reason, errorMessage: reason }), reason));
        await stream.result();
      });
      const { rows } = await queryCalls();
      expect(rows[0].status).toBe(status);
      expect(rows[0].ttftMs).toBe(1000);
      expect(rows[0].generationDurationMs).toBe(0);
      expect(rows[0].generationTps).toBeNull();
      expect(rows[0].endToEndTps).toBeNull();
    }
  });

  it("terminal replay never adds a second record", async () => {
    const c = fakeClock();
    const { runtime } = metricsRuntime(c.clock);
    await runWithLlmAuditContext(USER_CONTEXT, async () => {
      const stream = runtime.streamSimple(MODEL as never, { messages: [] }, {});
      c.advance(1000);
      stream.push(delta("text_delta", "x"));
      stream.push(done(assistantMessage()));
      stream.push(done(assistantMessage()));
      stream.push(errored(assistantMessage({ stopReason: "error" })));
      await stream.result();
    });
    const { total } = await queryCalls();
    expect(total).toBe(1);
  });

  it("keeps the model result working when metrics storage fails", async () => {
    const c = fakeClock();
    const manual = manualRuntime();
    const runtime = wrapModelCallMetrics(manual.runtime, {
      clock: c.clock,
      resolveContext: () => ({ sessionId: "s1", source: "user", purpose: "chat" }),
      record: () => {
        throw new Error("audit db is down");
      },
    });
    const stream = runtime.streamSimple(MODEL as never, { messages: [] }, {} as never) as AssistantMessageEventStream;
    stream.push(delta("text_delta", "ok"));
    stream.push(done(assistantMessage()));
    await expect(stream.result()).resolves.toMatchObject({ stopReason: "stop" });
  });
});

// ── production composition (getAuditModelRuntime) ─────────────────────────

describe("audited runtime composition", () => {
  it("records a main-chat call through getAuditModelRuntime with source/purpose/session", async () => {
    const g = globalThis as { __piLlmAuditModelRuntime?: ModelRuntime };
    delete g.__piLlmAuditModelRuntime;
    const manual = manualRuntime();
    const wrapped = getAuditModelRuntime(manual.runtime);

    await runWithLlmAuditContext(USER_CONTEXT, async () => {
      const stream = wrapped.streamSimple(MODEL as never, { messages: [] }, {});
      stream.push(delta("text_delta", "hello"));
      await new Promise((resolve) => setTimeout(resolve, 5));
      stream.push(delta("text_delta", " again"));
      await new Promise((resolve) => setTimeout(resolve, 5));
      stream.push(done(assistantMessage()));
      await stream.result();
    });
    delete g.__piLlmAuditModelRuntime;

    const { rows, total } = await queryCalls();
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({
      sessionId: "s1",
      source: "user",
      purpose: "chat",
      status: "completed",
      provider: "test-provider",
      modelId: "test-model",
      outputTokens: 120,
    });
    expect(rows[0].ttftMs).not.toBeNull();
    expect(rows[0].generationDurationMs).toBeGreaterThan(0);
    expect(rows[0].generationTps).not.toBeNull();
    expect(rows[0].endToEndTps).not.toBeNull();
  });
});

// ── billing compatibility, migration and query contract ───────────────────

describe("billing compatibility and query contract", () => {
  it("returns one row per real call and does not double count the cost summary", async () => {
    const c = fakeClock();
    const { runtime } = metricsRuntime(c.clock);
    const message = assistantMessage();
    await runWithLlmAuditContext(USER_CONTEXT, async () => {
      const stream = runtime.streamSimple(MODEL as never, { messages: [] }, {});
      stream.push(delta("text_delta", "hi"));
      c.advance(1000);
      stream.push(done(message));
      await stream.result();
    });
    // The legacy billing hook writes on message_end, i.e. after the stream.
    recordCall({
      sessionId: "s1",
      messageId: String(message.timestamp),
      source: "user",
      provider: "test-provider",
      modelId: "test-model",
      api: "test-api",
      ts: message.timestamp,
      inputTokens: 10,
      outputTokens: 120,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costInput: 0.1,
      costOutput: 0.2,
      costRead: 0,
      costWrite: 0,
      costTotal: 0.3,
      durationMs: 1000,
      error: null,
    });

    const { rows, total } = await queryCalls();
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].costTotal).toBe(0.3);
    expect(rows[0].ttftMs).toBe(0);
    expect(summarize("all", "none").totals).toMatchObject({ calls: 1, costTotal: 0.3 });
  });

  it("upgrades an old schema in place, keeps old rows, and stays repeatable", async () => {
    const file = switchToTempDb("legacy");
    const old = new Database(file);
    old.exec(`
      CREATE TABLE token_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        api TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        cost_input REAL NOT NULL DEFAULT 0,
        cost_output REAL NOT NULL DEFAULT 0,
        cost_read REAL NOT NULL DEFAULT 0,
        cost_write REAL NOT NULL DEFAULT 0,
        cost_total REAL NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        UNIQUE(session_id, message_id)
      );
    `);
    old.prepare(`
      INSERT INTO token_calls
        (ts, session_id, message_id, source, provider, model_id, api,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
         cost_input, cost_output, cost_read, cost_write, cost_total, duration_ms, error)
      VALUES (?, ?, ?, 'user', 'deepseek', 'deepseek-chat', 'openai-completions',
              10, 20, 0, 0, 0.01, 0.02, 0, 0, 0.03, 1234, NULL)
    `).run(1_700_000_000_000, "legacy-session", "legacy-message");
    old.close();

    const first = await queryCalls();
    expect(first.total).toBe(1);
    expect(first.rows[0]).toMatchObject({
      sessionId: "legacy-session",
      status: "unknown",
      purpose: "unknown",
      outputTokens: 20,
      durationMs: 1234,
      ttftMs: null,
      generationDurationMs: null,
      generationTps: null,
      endToEndTps: null,
    });
    expect(first.rows[0].callId).toMatch(/^token:\d+$/);

    // Re-open (runs the schema again) and add a new call beside the old row.
    resetDbGlobals();
    recordModelCall({
      callId: "new-call",
      startedAt: 1_700_000_001_000,
      sessionId: null,
      messageId: null,
      source: "direct",
      purpose: "translation",
      provider: "test-provider",
      modelId: "test-model",
      api: null,
      status: "completed",
      ttftMs: 100,
      generationDurationMs: 200,
      durationMs: 400,
      outputTokens: 10,
      error: null,
    });

    const second = await queryCalls();
    expect(second.total).toBe(2);
    // Ordered by call start desc, stable id as tie-break.
    expect(second.rows[0].callId).toBe("new-call");
    expect(second.rows[1].sessionId).toBe("legacy-session");
    expect(second.rows[0].source).toBe("direct");
    expect(second.rows[0].purpose).toBe("translation");
  });

  it("filters by session, includes session-less calls otherwise, and paginates with a matching total", async () => {
    const rows = [
      { callId: "a", startedAt: 3000, sessionId: "s1" },
      { callId: "b", startedAt: 2000, sessionId: null },
      { callId: "c", startedAt: 1000, sessionId: "s2" },
    ];
    for (const row of rows) {
      recordModelCall({
        callId: row.callId,
        startedAt: row.startedAt,
        sessionId: row.sessionId,
        messageId: null,
        source: "unknown",
        purpose: "unknown",
        provider: "p",
        modelId: "m",
        api: null,
        status: "unknown",
        ttftMs: null,
        generationDurationMs: null,
        durationMs: null,
        outputTokens: null,
        error: null,
      });
    }

    const all = await queryCalls("range=all&limit=2&offset=0");
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => r.callId)).toEqual(["a", "b"]);
    const next = await queryCalls("range=all&limit=2&offset=2");
    expect(next.total).toBe(3);
    expect(next.rows.map((r) => r.callId)).toEqual(["c"]);

    const session = await queryCalls("range=all&sessionId=s1");
    expect(session.total).toBe(1);
    expect(session.rows[0].callId).toBe("a");

    const noSession = await queryCalls("range=all&sessionId=nope");
    expect(noSession.total).toBe(0);
    expect(noSession.rows).toEqual([]);
  });
});
