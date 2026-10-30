import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordCall, recordModelCall, summarizeSessions } from "@/lib/server/token-audit-store";
import { createSubagentTask, listDescendantSubagentSessionIds } from "@/lib/server/subagent-store";
import type { ModelCallInsert, TokenCallInsert } from "@/lib/shared/token-audit-types";

let root: string;
let dbCounter = 0;

const originalLogFile = process.env.PI_WORK_LOG_FILE;
process.env.PI_WORK_LOG_FILE = "off";

function resetDbGlobals(): void {
  const g = globalThis as {
    __piTokenAuditDb?: { close: () => void };
    __piSubagentsDb?: { close: () => void };
  };
  g.__piTokenAuditDb?.close();
  delete g.__piTokenAuditDb;
  g.__piSubagentsDb?.close();
  delete g.__piSubagentsDb;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pi-work-session-summary-"));
});

beforeEach(() => {
  resetDbGlobals();
  const bucket = ++dbCounter;
  process.env.PI_WORK_TOKEN_AUDIT_DB = join(root, `session-summary-${bucket}.db`);
  process.env.PI_WORK_SUBAGENTS_DB = join(root, `subagents-${bucket}.db`);
});

afterAll(() => {
  resetDbGlobals();
  delete process.env.PI_WORK_TOKEN_AUDIT_DB;
  delete process.env.PI_WORK_SUBAGENTS_DB;
  if (originalLogFile === undefined) delete process.env.PI_WORK_LOG_FILE;
  else process.env.PI_WORK_LOG_FILE = originalLogFile;
  rmSync(root, { recursive: true, force: true });
});

let seq = 0;

function billing(overrides: Partial<TokenCallInsert> = {}): TokenCallInsert {
  seq += 1;
  return {
    ts: 1_700_000_000_000 + seq,
    sessionId: "session-a",
    messageId: `m-${seq}`,
    source: "user",
    provider: "test-provider",
    modelId: "test-model",
    api: "test-api",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 300,
    cacheWriteTokens: 20,
    costInput: 0.001,
    costOutput: 0.002,
    costRead: 0.0003,
    costWrite: 0.0002,
    costTotal: 0.0035,
    durationMs: 3_000,
    error: null,
    ...overrides,
  };
}

function metric(overrides: Partial<ModelCallInsert> = {}): ModelCallInsert {
  seq += 1;
  return {
    callId: `call-${seq}`,
    startedAt: 1_700_000_000_000 + seq,
    sessionId: "session-a",
    messageId: String(seq),
    source: "user",
    purpose: "chat",
    provider: "test-provider",
    modelId: "test-model",
    api: "test-api",
    status: "completed",
    ttftMs: 500,
    generationDurationMs: 2_000,
    durationMs: 3_000,
    outputTokens: 100,
    error: null,
    ...overrides,
  };
}

function spawnSubagentSession(parentSessionId: string, childSessionId: string): void {
  createSubagentTask({
    parentSessionId,
    childSessionId,
    subagentName: "explorer",
    description: "description",
    prompt: "prompt",
  });
}

describe("summarizeSessions", () => {
  it("returns empty-but-defined facts for a session with no records", () => {
    expect(summarizeSessions(["session-none"])).toEqual({
      inputTokens: 0,
      inputTokensWithCache: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costTotal: 0,
      cacheHitRate: null,
      avgTtftMs: null,
      avgGenerationTps: null,
    });
  });

  it("sums the session's tokens and cost, including cache tokens in the total", () => {
    recordCall(billing());
    recordCall(billing());
    recordCall(billing({ sessionId: "session-b", inputTokens: 9_999, costTotal: 9 }));

    const summary = summarizeSessions(["session-a"]);
    expect(summary.inputTokens).toBe(200);
    expect(summary.outputTokens).toBe(100);
    expect(summary.cacheReadTokens).toBe(600);
    expect(summary.cacheWriteTokens).toBe(40);
    expect(summary.totalTokens).toBe(200 + 100 + 600 + 40);
    expect(summary.inputTokensWithCache).toBe(200 + 600 + 40);
    expect(summary.totalTokens).toBe(summary.inputTokensWithCache + summary.outputTokens);
    expect(summary.costTotal).toBeCloseTo(0.007, 10);
  });

  it("weights the cache hit rate by tokens, not by call", () => {
    recordCall(billing({ inputTokens: 100, cacheReadTokens: 900 }));
    recordCall(billing({ inputTokens: 900, cacheReadTokens: 100 }));

    expect(summarizeSessions(["session-a"]).cacheHitRate).toBeCloseTo(0.5, 10);
  });

  it("reports null hit rate when no input was billed", () => {
    recordCall(billing({ inputTokens: 0, cacheReadTokens: 0 }));
    expect(summarizeSessions(["session-a"]).cacheHitRate).toBeNull();
  });

  it("weights generation speed by duration instead of averaging per call", () => {
    recordModelCall(metric({ ttftMs: 400, generationDurationMs: 1_000, outputTokens: 100 }));
    recordModelCall(metric({ ttftMs: 800, generationDurationMs: 2_000, outputTokens: 50 }));

    const summary = summarizeSessions(["session-a"]);
    expect(summary.avgTtftMs).toBe(600);
    expect(summary.avgGenerationTps).toBeCloseTo(50, 10);
  });

  it("ignores non-chat calls when reading the conversation's speed", () => {
    recordModelCall(metric({ generationDurationMs: 1_000, outputTokens: 100 }));
    recordModelCall(
      metric({ purpose: "translation", generationDurationMs: 1_000, outputTokens: 5_000 }),
    );

    expect(summarizeSessions(["session-a"]).avgGenerationTps).toBeCloseTo(100, 10);
  });

  it("ignores generation windows too short to measure", () => {
    recordModelCall(metric({ generationDurationMs: 1_000, outputTokens: 100 }));
    recordModelCall(metric({ generationDurationMs: 50, outputTokens: 300 }));

    expect(summarizeSessions(["session-a"]).avgGenerationTps).toBeCloseTo(100, 10);
  });

  it("reports null speed when every window is unmeasurable", () => {
    recordModelCall(metric({ generationDurationMs: 50, outputTokens: 300 }));
    recordModelCall(metric({ purpose: "auto-name", generationDurationMs: 1_000, outputTokens: 30 }));

    expect(summarizeSessions(["session-a"]).avgGenerationTps).toBeNull();
  });

  it("skips rows with no measurable TTFT or throughput instead of counting them as zero", () => {
    recordModelCall(metric({ ttftMs: 900, generationDurationMs: 1_000, outputTokens: 50 }));
    recordModelCall(
      metric({ ttftMs: null, generationDurationMs: null, durationMs: null, outputTokens: null }),
    );
    recordModelCall(
      metric({ status: "failed", ttftMs: null, generationDurationMs: 1_000, outputTokens: 50 }),
    );

    const summary = summarizeSessions(["session-a"]);
    expect(summary.avgTtftMs).toBe(900);
    expect(summary.avgGenerationTps).toBeCloseTo(50, 10);
  });

  it("keeps a zero TTFT as a measurement", () => {
    recordModelCall(metric({ ttftMs: 0 }));
    expect(summarizeSessions(["session-a"]).avgTtftMs).toBe(0);
  });

  it("ignores other sessions' metric and billing rows", () => {
    recordCall(billing({ sessionId: "session-b" }));
    recordModelCall(metric({ sessionId: "session-b", ttftMs: 5_000 }));

    const summary = summarizeSessions(["session-a"]);
    expect(summary.totalTokens).toBe(0);
    expect(summary.avgTtftMs).toBeNull();
    expect(summary.avgGenerationTps).toBeNull();
  });

  it("rolls a conversation's subagent sessions into the same numbers", () => {
    spawnSubagentSession("session-parent", "session-child");
    spawnSubagentSession("session-child", "session-grandchild");

    recordCall(billing({ sessionId: "session-parent" }));
    recordModelCall(
      metric({ sessionId: "session-parent", generationDurationMs: 1_000, outputTokens: 200 }),
    );
    recordCall(billing({ sessionId: "session-child" }));
    recordCall(billing({ sessionId: "session-grandchild" }));
    recordModelCall(
      metric({ sessionId: "session-child", generationDurationMs: 3_000, outputTokens: 600 }),
    );

    const parentOnly = summarizeSessions(["session-parent"]);
    expect(parentOnly.totalTokens).toBe(100 + 50 + 300 + 20);
    expect(parentOnly.avgGenerationTps).toBeCloseTo(200, 10);

    const subtree = summarizeSessions([
      "session-parent",
      ...listDescendantSubagentSessionIds("session-parent"),
    ]);
    expect(subtree.totalTokens).toBe(3 * (100 + 50 + 300 + 20));
    expect(subtree.costTotal).toBeCloseTo(3 * 0.0035, 10);
    expect(subtree.avgGenerationTps).toBeCloseTo(200, 10);
  });

  it("de-duplicates repeated session ids", () => {
    recordCall(billing());

    expect(summarizeSessions(["session-a", "session-a"]).totalTokens).toBe(100 + 50 + 300 + 20);
  });

  it("returns the empty rollup for no sessions at all", () => {
    recordCall(billing());

    expect(summarizeSessions([]).totalTokens).toBe(0);
    expect(summarizeSessions([]).cacheHitRate).toBeNull();
  });
});

describe("listDescendantSubagentSessionIds", () => {
  it("returns nothing (and creates nothing) when no subagent ever ran", () => {
    const dbPath = process.env.PI_WORK_SUBAGENTS_DB as string;

    expect(listDescendantSubagentSessionIds("session-parent")).toEqual([]);
    expect(existsSync(dbPath)).toBe(false);
  });

  it("walks children and grandchildren", () => {
    spawnSubagentSession("session-parent", "session-child");
    spawnSubagentSession("session-parent", "session-child-2");
    spawnSubagentSession("session-child", "session-grandchild");
    spawnSubagentSession("session-other", "session-unrelated");

    expect(listDescendantSubagentSessionIds("session-parent").sort()).toEqual([
      "session-child",
      "session-child-2",
      "session-grandchild",
    ]);
  });

  it("reports a reused child session once", () => {
    spawnSubagentSession("session-parent", "session-child");
    spawnSubagentSession("session-parent", "session-child");

    expect(listDescendantSubagentSessionIds("session-parent")).toEqual(["session-child"]);
  });

  it("terminates on a parent ⇄ child cycle", () => {
    spawnSubagentSession("session-a", "session-b");
    spawnSubagentSession("session-b", "session-a");

    expect(listDescendantSubagentSessionIds("session-a")).toEqual(["session-b"]);
  });
});
