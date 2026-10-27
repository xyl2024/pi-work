import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderCallInsert } from "@/lib/shared/llm-audit-types";
import type { ModelCallInsert } from "@/lib/shared/token-audit-types";

/**
 * `GET /api/llm-audit/messages/[messageId]/request-body?sessionId=…` — the
 * chat's download action. Driven at the route level (real `Request`, real temp
 * SQLite files) because the contract that matters is the HTTP one: an
 * attachment a browser will save, and a clear 404 when the request was never
 * captured (so the button can say so instead of downloading an empty file).
 */

const MESSAGE_ID = "1700000000000";
const SESSION_ID = "session-1";

let dir: string;
const originalLogFile = process.env.PI_WORK_LOG_FILE;
process.env.PI_WORK_LOG_FILE = "off";

let GET: typeof import("@/app/api/llm-audit/messages/[messageId]/request-body/route")["GET"];
let insertProviderCall: typeof import("@/lib/server/llm-audit-db")["insertProviderCall"];
let recordModelCall: typeof import("@/lib/server/token-audit-store")["recordModelCall"];

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
  const name = `route-${++counter}`;
  process.env.PI_WORK_LLM_AUDIT_DB = join(dir, `${name}-llm-audit.db`);
  process.env.PI_WORK_TOKEN_AUDIT_DB = join(dir, `${name}-token-audit.db`);
  process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS = "0";
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-request-body-route-"));
  switchToFreshDbs();
  ({ GET } = await import("@/app/api/llm-audit/messages/[messageId]/request-body/route"));
  ({ insertProviderCall } = await import("@/lib/server/llm-audit-db"));
  ({ recordModelCall } = await import("@/lib/server/token-audit-store"));
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
    callId: "call-1",
    requestBody: `{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}`,
    requestHeaders: null,
    status: 200,
    responseHeaders: null,
    responseBody: null,
    error: null,
    durationMs: 900,
    ...overrides,
  };
}

function request(messageId = MESSAGE_ID, sessionId: string | null = SESSION_ID): Request {
  const query = sessionId === null ? "" : `?sessionId=${encodeURIComponent(sessionId)}`;
  return new Request(`http://localhost/api/llm-audit/messages/${messageId}/request-body${query}`);
}

describe("GET /api/llm-audit/messages/[messageId]/request-body", () => {
  it("serves the formatted request body as a JSON attachment", async () => {
    recordModelCall(modelCall());
    insertProviderCall(providerCall());

    const response = await GET(request(), { params: Promise.resolve({ messageId: MESSAGE_ID }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="request-body-deepseek-chat-20231114T221320Z.json"',
    );
    expect(await response.text()).toBe(
      [
        "{",
        '  "model": "deepseek-chat",',
        '  "messages": [',
        "    {",
        '      "role": "user",',
        '      "content": "hi"',
        "    }",
        "  ]",
        "}",
      ].join("\n"),
    );
  });

  it("answers 404 when the message has no captured request", async () => {
    const response = await GET(request("unknown"), { params: Promise.resolve({ messageId: "unknown" }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No request body captured for this message" });
  });

  it("answers 400 without a session id", async () => {
    const response = await GET(request(MESSAGE_ID, null), { params: Promise.resolve({ messageId: MESSAGE_ID }) });

    expect(response.status).toBe(400);
  });
});
