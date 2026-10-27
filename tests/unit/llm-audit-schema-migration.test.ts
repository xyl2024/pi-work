import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { ProviderCallInsert } from "@/lib/shared/llm-audit-types";

/**
 * The audit DB of an install that ran before request bodies were linked to
 * model calls has no `call_id` column. Opening it must still work (idempotent
 * migration), keep the old rows readable, and accept new rows with a call id —
 * the chat's download button relies on that column existing.
 */

let dir: string;
const originalLogFile = process.env.PI_WORK_LOG_FILE;
process.env.PI_WORK_LOG_FILE = "off";

/** Schema as shipped before `call_id` (and before cwd/session_name). */
const LEGACY_SCHEMA = `
  CREATE TABLE provider_calls (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                INTEGER NOT NULL,
    session_id        TEXT,
    source            TEXT,
    provider          TEXT,
    model_id          TEXT,
    api               TEXT,
    url               TEXT    NOT NULL,
    attempt           INTEGER NOT NULL DEFAULT 1,
    request_body      TEXT,
    request_headers   TEXT,
    status            INTEGER,
    response_headers  TEXT,
    response_body     TEXT,
    error             TEXT,
    duration_ms       INTEGER,
    cwd               TEXT,
    session_name      TEXT
  );
  CREATE INDEX idx_provider_calls_ts      ON provider_calls(ts DESC);
  CREATE INDEX idx_provider_calls_session ON provider_calls(session_id, ts DESC);
  CREATE INDEX idx_provider_calls_status  ON provider_calls(status);
`;

let getProviderCall: typeof import("@/lib/server/llm-audit-db")["getProviderCall"];
let insertProviderCall: typeof import("@/lib/server/llm-audit-db")["insertProviderCall"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-llm-audit-migration-"));
  const dbPath = join(dir, "legacy.db");

  const legacy = new Database(dbPath);
  legacy.exec(LEGACY_SCHEMA);
  legacy
    .prepare(
      `INSERT INTO provider_calls
         (ts, session_id, source, provider, model_id, api, url, attempt, request_body, status, duration_ms, cwd, session_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(1, "s1", "user", "deepseek", "deepseek-chat", "openai-completions", "https://api.deepseek.com/v1/chat/completions", 1, `{"legacy":true}`, 200, 10, "/tmp", null);
  legacy.close();

  process.env.PI_WORK_LLM_AUDIT_DB = dbPath;
  process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS = "0";
  ({ getProviderCall, insertProviderCall } = await import("@/lib/server/llm-audit-db"));
});

afterAll(() => {
  const g = globalThis as { __piLlmAuditDb?: { close: () => void } };
  g.__piLlmAuditDb?.close();
  delete g.__piLlmAuditDb;
  delete process.env.PI_WORK_LLM_AUDIT_DB;
  delete process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS;
  if (originalLogFile === undefined) delete process.env.PI_WORK_LOG_FILE;
  else process.env.PI_WORK_LOG_FILE = originalLogFile;
  rmSync(dir, { recursive: true, force: true });
});

function insert(callId: string | null, ts: number): number {
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
    callId,
    requestBody: `{"ts":${ts}}`,
    requestHeaders: null,
    status: 200,
    responseHeaders: null,
    responseBody: null,
    error: null,
    durationMs: 10,
  };
  return insertProviderCall(row);
}

describe("llm-audit schema migration", () => {
  it("keeps a pre-existing database open and readable", () => {
    expect(getProviderCall(1)?.requestBody).toBe(`{"legacy":true}`);
    expect(getProviderCall(1)?.callId).toBeNull();
  });

  it("stores and returns the call id on new rows", () => {
    const id = insert("call-new", 2);
    expect(getProviderCall(id)?.callId).toBe("call-new");
  });
});
