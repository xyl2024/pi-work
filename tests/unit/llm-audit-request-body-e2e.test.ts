import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const MODEL = { provider: "fake-provider", id: "fake-model", api: "fake-api" } as const;
const SESSION_ID = "session-e2e";
const MESSAGE = {
  role: "assistant",
  content: [{ type: "text", text: "hi" }],
  api: "fake-api",
  provider: "fake-provider",
  model: "fake-model",
  usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
  stopReason: "stop",
  timestamp: 1_700_000_000_000,
} as unknown as AssistantMessage;

const REQUEST_BODY = JSON.stringify({
  model: "fake-model",
  messages: [{ role: "user", content: "hello" }],
});

let dir: string;
const originalLogFile = process.env.PI_WORK_LOG_FILE;
process.env.PI_WORK_LOG_FILE = "off";

let fetchCalls: string[] = [];
let getAuditModelRuntime: typeof import("@/lib/server/llm-audit")["getAuditModelRuntime"];
let runWithLlmAuditContext: typeof import("@/lib/server/llm-audit")["runWithLlmAuditContext"];
let getMessageRequestBody: typeof import("@/lib/server/llm-audit-message-body")["getMessageRequestBody"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-request-body-e2e-"));
  process.env.PI_WORK_LLM_AUDIT_DB = join(dir, "llm-audit.db");
  process.env.PI_WORK_TOKEN_AUDIT_DB = join(dir, "token-audit.db");
  process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS = "0";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push(String(input));
    expect(init?.body).toBe(REQUEST_BODY);
    return new Response("", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  ({ getAuditModelRuntime, runWithLlmAuditContext } = await import("@/lib/server/llm-audit"));
  ({ getMessageRequestBody } = await import("@/lib/server/llm-audit-message-body"));
});

afterAll(() => {
  delete process.env.PI_WORK_LLM_AUDIT_DB;
  delete process.env.PI_WORK_TOKEN_AUDIT_DB;
  delete process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS;
  if (originalLogFile === undefined) delete process.env.PI_WORK_LOG_FILE;
  else process.env.PI_WORK_LOG_FILE = originalLogFile;
  rmSync(dir, { recursive: true, force: true });
});

function fakeRuntime(): ModelRuntime {
  return {
    getProviders: () => [
      {
        baseUrl: "https://api.fake.test",
        getModels: () => [],
      },
    ],
    stream: fakeStream,
    streamSimple: fakeStream,
  } as unknown as ModelRuntime;

  function fakeStream() {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      await fetch("https://api.fake.test/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: REQUEST_BODY,
      });
      stream.push({
        type: "text_delta",
        contentIndex: 0,
        delta: "hi",
        partial: MESSAGE,
      } as AssistantMessageEvent);
      stream.push({ type: "done", reason: "stop", message: MESSAGE } as AssistantMessageEvent);
    })();
    return stream;
  }
}

describe("request body download chain", () => {
  it("finds the captured body through the call id stored for the message", async () => {
    fetchCalls = [];
    const runtime = getAuditModelRuntime(fakeRuntime());

    await runWithLlmAuditContext(
      { sessionId: SESSION_ID, source: "user", purpose: "chat", cwd: "/tmp", sessionName: null },
      async () => {
        const stream = runtime.streamSimple(MODEL as never, { messages: [] }, {});
        await stream.result();
      },
    );

    expect(fetchCalls).toEqual(["https://api.fake.test/v1/chat/completions"]);

    const result = getMessageRequestBody({
      sessionId: SESSION_ID,
      messageId: String(MESSAGE.timestamp),
    });

    expect(result).not.toBeNull();
    expect(result?.fileName).toMatch(/^request-body-fake-model-\d{8}T\d{6}Z\.json$/);
    expect(JSON.parse(result?.content ?? "")).toEqual(JSON.parse(REQUEST_BODY));
    expect(result?.content).toContain('\n  "model": "fake-model"');
  });
});
