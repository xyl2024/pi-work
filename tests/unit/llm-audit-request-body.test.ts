import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderCallInsert } from "@/lib/shared/llm-audit-types";
import type { ModelCallInsert } from "@/lib/shared/token-audit-types";

/**
 * The download seam: given the assistant message the chat is showing
 * (`sessionId` + `message.timestamp`), find the HTTP request body that
 * produced it, formatted and named for a file download.
 *
 * The two facts live in two databases — the audit log knows requests and the
 * call id, the token-audit log knows which call produced which message — so
 * this is exercised against real temporary SQLite files. A missing/old record
 * must come back as `null` (the button reports "nothing captured") instead of
 * throwing or downloading an empty file.
 */

const MESSAGE_ID = "1700000000000";
const SESSION_ID = "session-1";

let dir: string;
const originalLogFile = process.env.PI_WORK_LOG_FILE;
process.env.PI_WORK_LOG_FILE = "off";

function resetDbGlobals(): void {
  const g = globalThis as {
    __piLlmAuditDb?: { close: () => void };
    __piLlmAuditLastPrune?: number;
    __piTokenAuditDb?: { close: () => void };
  };
  g.__piLlmAuditDb?.close();
  delete g.__piLlmAuditDb;
  delete g.__piLlmAuditLastPrune;
  g.__piTokenAuditDb?.close();
  delete g.__piTokenAuditDb;
}

let counter = 0;
function switchToFreshDbs(): void {
  resetDbGlobals();
  const name = `case-${++counter}`;
  process.env.PI_WORK_LLM_AUDIT_DB = join(dir, `${name}-llm-audit.db`);
  process.env.PI_WORK_TOKEN_AUDIT_DB = join(dir, `${name}-token-audit.db`);
  process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS = "0";
}

type Modules = {
  insertProviderCall: typeof import("@/lib/server/llm-audit-db")["insertProviderCall"];
  recordModelCall: typeof import("@/lib/server/token-audit-store")["recordModelCall"];
  getMessageRequestBody: typeof import("@/lib/server/llm-audit-message-body")["getMessageRequestBody"];
};

let mods: Modules;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-request-body-"));
  switchToFreshDbs();
  mods = {
    insertProviderCall: (await import("@/lib/server/llm-audit-db")).insertProviderCall,
    recordModelCall: (await import("@/lib/server/token-audit-store")).recordModelCall,
    getMessageRequestBody: (await import("@/lib/server/llm-audit-message-body")).getMessageRequestBody,
  };
});

beforeEach(() => {
  switchToFreshDbs();
});

afterAll(() => {
  resetDbGlobals();
  delete process.env.PI_WORK_LLM_AUDIT_DB;
  delete process.env.PI_WORK_TOKEN_AUDIT_DB;
  delete process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS;
  if (originalLogFile === undefined) delete process.env.PI_WORK_LOG_FILE;
  else process.env.PI_WORK_LOG_FILE = originalLogFile;
  rmSync(dir, { recursive: true, force: true });
});

function modelCall(overrides: Partial<ModelCallInsert> = {}): ModelCallInsert {
  return {
    callId: "call-1",
    startedAt: 1_700_000_000_000,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    source: "user",
    purpose: "chat",
    provider: "deepseek",
    modelId: "deepseek-chat",
    api: "openai-completions",
    status: "completed",
    ttftMs: 400,
    generationDurationMs: 2000,
    durationMs: 3000,
    outputTokens: 120,
    error: null,
    ...overrides,
  };
}

function providerCall(overrides: Partial<ProviderCallInsert> = {}): ProviderCallInsert {
  return {
    ts: 1_700_000_000_100,
    sessionId: SESSION_ID,
    source: "user",
    cwd: "/tmp",
    sessionName: null,
    provider: "deepseek",
    modelId: "deepseek-chat",
    api: "openai-completions",
    url: "https://api.deepseek.com/v1/chat/completions",
    attempt: 1,
    requestBody: `{"model":"deepseek-chat"}`,
    requestHeaders: null,
    status: 200,
    responseHeaders: null,
    responseBody: null,
    error: null,
    durationMs: 900,
    callId: "call-1",
    ...overrides,
  };
}

describe("getMessageRequestBody", () => {
  it("returns the successful attempt of the call that produced the message", () => {
    mods.recordModelCall(modelCall());
    mods.insertProviderCall(
      providerCall({ attempt: 1, status: 429, requestBody: `{"attempt":1}`, ts: 1_700_000_000_100 }),
    );
    mods.insertProviderCall(
      providerCall({ attempt: 2, status: 200, requestBody: `{"attempt":2}`, ts: 1_700_000_000_500 }),
    );

    const result = mods.getMessageRequestBody({ sessionId: SESSION_ID, messageId: MESSAGE_ID });

    expect(result?.fileName).toBe("request-body-deepseek-chat-20231114T221320Z.json");
    expect(result?.content).toBe('{\n  "attempt": 2\n}');
  });

  it("ignores requests of other calls and of the same message id in another session", () => {
    mods.recordModelCall(modelCall());
    mods.insertProviderCall(providerCall({ callId: "call-other", requestBody: `{"wrong":"call"}` }));
    // Same message id, different session: the call id decides, so this one is
    // not part of the message's call list.
    mods.recordModelCall(modelCall({ callId: "call-2", sessionId: "session-2" }));
    mods.insertProviderCall(
      providerCall({ callId: "call-2", sessionId: "session-2", requestBody: `{"wrong":"session"}` }),
    );

    expect(mods.getMessageRequestBody({ sessionId: SESSION_ID, messageId: MESSAGE_ID })).toBeNull();
  });

  it("returns null for a message whose call predates request-body capture", () => {
    // Old rows exist without a call id, so nothing can be attributed.
    mods.recordModelCall(modelCall({ callId: "call-legacy" }));
    mods.insertProviderCall(providerCall({ callId: null, requestBody: `{"legacy":true}` }));

    expect(mods.getMessageRequestBody({ sessionId: SESSION_ID, messageId: MESSAGE_ID })).toBeNull();
  });

  it("returns null when the call was recorded but no request was captured", () => {
    mods.recordModelCall(modelCall({ callId: "call-2" }));

    expect(mods.getMessageRequestBody({ sessionId: SESSION_ID, messageId: MESSAGE_ID })).toBeNull();
  });
});
