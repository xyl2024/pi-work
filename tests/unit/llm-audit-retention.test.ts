import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderCallInsert } from "@/lib/shared/llm-audit-types";

type DbModule = typeof import("@/lib/server/llm-audit-db");

const DAY = 24 * 60 * 60 * 1000;

let dir: string;

function resetDbGlobals(): void {
  const g = globalThis as {
    __piLlmAuditDb?: { close: () => void };
    __piLlmAuditLastPrune?: number;
  };
  g.__piLlmAuditDb?.close();
  delete g.__piLlmAuditDb;
  delete g.__piLlmAuditLastPrune;
}

async function freshDb(name: string): Promise<DbModule> {
  resetDbGlobals();
  process.env.PI_WORK_LLM_AUDIT_DB = join(dir, `${name}.db`);
  process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS = "0";
  return import("@/lib/server/llm-audit-db");
}

function insert(db: DbModule, ts: number, id = ts): void {
  const row: ProviderCallInsert = {
    ts,
    sessionId: "s1",
    source: "user",
    cwd: "/tmp",
    sessionName: null,
    provider: "deepseek",
    modelId: "deepseek-chat",
    api: "openai-completions",
    url: "https://api.deepseek.com/v1/chat/completions",
    attempt: 1,
    callId: null,
    requestBody: `{"id":${id}}`,
    requestHeaders: null,
    status: 200,
    responseHeaders: null,
    responseBody: null,
    error: null,
    durationMs: 12,
  };
  db.insertProviderCall(row);
}

async function drainImmediates(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-llm-audit-"));
});

afterAll(() => {
  resetDbGlobals();
  delete process.env.PI_WORK_LLM_AUDIT_DB;
  delete process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS;
  rmSync(dir, { recursive: true, force: true });
});

describe("llm-audit retention", () => {
  it("deletes only rows older than the window", async () => {
    const db = await freshDb("window");
    const now = Date.now();
    insert(db, now);
    insert(db, now - 10 * DAY);
    insert(db, now - 40 * DAY);
    insert(db, now - 400 * DAY);
    expect(db.auditTotals().calls).toBe(4);

    process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS = "30";
    expect(db.pruneProviderCalls(now)).toBe(2);
    expect(db.auditTotals().calls).toBe(2);
    expect(db.pruneProviderCalls(now)).toBe(0);
  });

  it("keeps the default 30-day window when the env var is unset", async () => {
    const db = await freshDb("default");
    const now = Date.now();
    insert(db, now - 29 * DAY);
    insert(db, now - 31 * DAY);

    delete process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS;
    expect(db.pruneProviderCalls(now)).toBe(1);
    expect(db.auditTotals().calls).toBe(1);
  });

  it("keeps everything when retention is disabled", async () => {
    const db = await freshDb("disabled");
    const now = Date.now();
    insert(db, now - 500 * DAY);
    insert(db, now - 5 * DAY);

    expect(db.pruneProviderCalls(now)).toBe(0);
    expect(db.auditTotals().calls).toBe(2);
  });

  it("drains a backlog larger than one delete batch in a single pass", async () => {
    const db = await freshDb("batch");
    const now = Date.now();
    const oldRows = 1200;
    for (let i = 0; i < oldRows; i++) insert(db, now - (60 * DAY) - i * 1000, i);
    insert(db, now);

    process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS = "30";
    expect(db.pruneProviderCalls(now)).toBe(oldRows);
    expect(db.auditTotals().calls).toBe(1);
  });

  it("prunes automatically after an insert, off the insert call", async () => {
    const db = await freshDb("auto");
    const now = Date.now();
    insert(db, now - 90 * DAY);
    expect(db.auditTotals().calls).toBe(1);

    process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS = "30";
    delete (globalThis as { __piLlmAuditLastPrune?: number }).__piLlmAuditLastPrune;
    insert(db, now);
    expect(db.auditTotals().calls).toBe(2);

    await drainImmediates();
    expect(db.auditTotals().calls).toBe(1);
  });

  it("does not prune again inside the throttle window", async () => {
    const db = await freshDb("throttle");
    const now = Date.now();
    insert(db, now - 90 * DAY);
    process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS = "30";
    delete (globalThis as { __piLlmAuditLastPrune?: number }).__piLlmAuditLastPrune;

    insert(db, now);
    await drainImmediates();
    expect(db.auditTotals().calls).toBe(1);

    insert(db, now - 91 * DAY);
    await drainImmediates();
    expect(db.auditTotals().calls).toBe(2);
  });
});
