import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMessageCallMetrics, recordModelCall } from "@/lib/server/token-audit-store";
import type { ModelCallInsert } from "@/lib/shared/token-audit-types";
import { GET } from "@/app/api/token-audit/message-metrics/route";

/**
 * The chat footer's TTFT/TPS path: rows written by the model-call recorder are
 * read back per session, keyed by the message id the recorder stamps
 * (`String(message.timestamp)`), with throughput derived at read time.
 *
 * Process-internal (temporary SQLite, no HTTP instance): run with
 * `PI_WORK_TEST_SKIP_INSTANCE=1`.
 */

let root: string;
let dbCounter = 0;

const originalLogFile = process.env.PI_WORK_LOG_FILE;
process.env.PI_WORK_LOG_FILE = "off";

function resetDbGlobals(): void {
  const g = globalThis as { __piTokenAuditDb?: { close: () => void } };
  g.__piTokenAuditDb?.close();
  delete g.__piTokenAuditDb;
}

function switchToTempDb(): string {
  resetDbGlobals();
  const file = join(root, `message-metrics-${++dbCounter}.db`);
  process.env.PI_WORK_TOKEN_AUDIT_DB = file;
  return file;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pi-work-message-metrics-"));
});

beforeEach(() => {
  switchToTempDb();
});

afterAll(() => {
  resetDbGlobals();
  delete process.env.PI_WORK_TOKEN_AUDIT_DB;
  if (originalLogFile === undefined) delete process.env.PI_WORK_LOG_FILE;
  else process.env.PI_WORK_LOG_FILE = originalLogFile;
  rmSync(root, { recursive: true, force: true });
});

let callSeq = 0;

function call(overrides: Partial<ModelCallInsert> = {}): ModelCallInsert {
  callSeq += 1;
  return {
    callId: `call-${callSeq}`,
    startedAt: 1_700_000_000_000 + callSeq,
    sessionId: "session-a",
    messageId: String(1_700_000_000_000 + callSeq),
    source: "user",
    purpose: "chat",
    provider: "test-provider",
    modelId: "test-model",
    api: "test-api",
    status: "completed",
    ttftMs: 500,
    generationDurationMs: 2_000,
    durationMs: 3_000,
    outputTokens: 120,
    error: null,
    ...overrides,
  };
}

function insert(input: ModelCallInsert): void {
  recordModelCall(input);
}

describe("listMessageCallMetrics", () => {
  it("returns TTFT and derived generation TPS per message id", () => {
    insert(call({ messageId: "m1", ttftMs: 500, generationDurationMs: 2_000, outputTokens: 120 }));

    const [row] = listMessageCallMetrics("session-a");
    expect(row.messageId).toBe("m1");
    expect(row.status).toBe("completed");
    expect(row.ttftMs).toBe(500);
    expect(row.generationDurationMs).toBe(2_000);
    expect(row.generationTps).toBe(60);
    expect(row.outputTokens).toBe(120);
  });

  it("never fabricates throughput for a failed call but keeps the real TTFT", () => {
    insert(call({ messageId: "m-failed", status: "failed", ttftMs: 800, error: "boom" }));

    const [row] = listMessageCallMetrics("session-a");
    expect(row.status).toBe("failed");
    expect(row.ttftMs).toBe(800);
    expect(row.generationTps).toBeNull();
  });

  it("reports null TPS when no generation window was observed", () => {
    insert(call({ messageId: "m-single-chunk", generationDurationMs: 0, outputTokens: 4 }));

    const [row] = listMessageCallMetrics("session-a");
    expect(row.generationDurationMs).toBe(0);
    expect(row.generationTps).toBeNull();
  });

  it("keeps a reported zero TTFT as a measurement, not as missing", () => {
    insert(call({ messageId: "m-instant", ttftMs: 0 }));

    const [row] = listMessageCallMetrics("session-a");
    expect(row.ttftMs).toBe(0);
  });

  it("skips rows without a message id and rows from other sessions", () => {
    insert(call({ messageId: null, sessionId: "session-a" }));
    insert(call({ messageId: "m-other", sessionId: "session-b" }));
    insert(call({ messageId: "m-here", sessionId: "session-a" }));

    const rows = listMessageCallMetrics("session-a");
    expect(rows.map((r) => r.messageId)).toEqual(["m-here"]);
  });

  it("returns an empty list for a session with no recorded calls", () => {
    expect(listMessageCallMetrics("session-none")).toEqual([]);
  });
});

describe("GET /api/token-audit/message-metrics", () => {
  function request(query: string): Request {
    return new Request(`http://localhost/api/token-audit/message-metrics${query}`);
  }

  it("rejects a missing sessionId", async () => {
    const response = await GET(request(""));
    expect(response.status).toBe(400);
  });

  it("returns the session's metrics keyed by message id", async () => {
    insert(call({ messageId: "m1", ttftMs: 250, generationDurationMs: 1_000, outputTokens: 50 }));
    insert(call({ messageId: "m2", sessionId: "session-b" }));

    const response = await GET(request("?sessionId=session-a"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { metrics: Array<{ messageId: string; ttftMs: number; generationTps: number }> };
    expect(body.metrics).toHaveLength(1);
    expect(body.metrics[0]).toMatchObject({ messageId: "m1", ttftMs: 250, generationTps: 50 });
  });
});
