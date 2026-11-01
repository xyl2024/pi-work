import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  completeSubagentTask,
  createSubagentTask,
  markSubagentRunning,
} from "@/lib/server/subagent-store";
import { recordModelCall } from "@/lib/server/token-audit-store";
import type { ModelCallInsert } from "@/lib/shared/token-audit-types";
import type { SubagentSessionStatsView, SubagentTaskSummary } from "@/lib/shared/types";

let dir: string;
let agentDir: string;
let savedAgentDir: string | undefined;
let savedDataDir: string | undefined;
let savedTokenAuditDb: string | undefined;
let GET: typeof import("@/app/api/sessions/[id]/subagents/route")["GET"];

const DEFAULT_PARENT = "parent-sessions-api";

function resetGlobals(): void {
  const g = globalThis as {
    __piTokenAuditDb?: { close: () => void };
    __piSubagentsDb?: { close: () => void };
    [key: string]: unknown;
  };
  g.__piTokenAuditDb?.close();
  delete g.__piTokenAuditDb;
  g.__piSubagentsDb?.close();
  delete g.__piSubagentsDb;
  delete g.__piSubagentProfilesSeeded;
  delete g.__piSubagentLiveCache;
  delete g.__piSubagentStatsCache;
  delete g.__piSessionPathCache;
  delete g.__piSessionListCache;
  delete g.__piSessionListHeaderCache;
  delete g.__piSessionListInflight;
  delete g.__piSessionListHeaderInflight;
}

interface FixtureMessage {
  role: "user" | "assistant" | "toolResult";
  [key: string]: unknown;
}

function defaultMessages(): FixtureMessage[] {
  return [
    {
      role: "user",
      timestamp: 1,
      content: [{ type: "text", text: "summarize the repository" }],
    },
    {
      role: "assistant",
      timestamp: 2,
      provider: "anthropic",
      model: "claude-test",
      content: [{ type: "text", text: "looking around" }],
    },
    {
      role: "assistant",
      timestamp: 3,
      provider: "anthropic",
      model: "claude-test",
      content: [
        { type: "text", text: "found it" },
        { type: "toolCall", toolCallId: "t1", toolName: "read", input: { path: "/a.ts" } },
      ],
    },
  ];
}

function writeChildSession(sessionId: string, messages: FixtureMessage[] = defaultMessages()): void {
  const sessionDir = join(agentDir, "sessions", "--tmp-project--");
  mkdirSync(sessionDir, { recursive: true });
  const header = JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-01-02T03:04:05.000Z",
    cwd: "/tmp/project",
  }) + "\n";
  const entries = [
    {
      type: "message",
      id: "e0",
      parentId: null,
      timestamp: "2026-01-02T03:04:06.000Z",
      message: messages[0],
    },
    ...messages.slice(1).map((message, index) => ({
      type: "message",
      id: `e${index + 1}`,
      parentId: `e${index}`,
      timestamp: "2026-01-02T03:04:07.000Z",
      message,
    })),
  ].map((entry) => JSON.stringify(entry) + "\n");
  writeFileSync(join(sessionDir, `${sessionId}.jsonl`), [header, ...entries].join(""), "utf8");
  resetGlobals();
}

function seedTask(
  parent: string,
  taskId: string,
  childSessionId: string | null,
  description: string,
): void {
  createSubagentTask({
    taskId,
    parentSessionId: parent,
    subagentName: "codebase_explorer",
    description,
    prompt: "the prompt",
    childSessionId,
  });
  if (childSessionId) {
    markSubagentRunning(parent, taskId, childSessionId);
    completeSubagentTask(parent, taskId, `${description} done`);
  }
}

async function readRoute(parent = DEFAULT_PARENT): Promise<{
  tasks: SubagentTaskSummary[];
  sessions: SubagentSessionStatsView[];
}> {
  const response = await GET(
    new Request(`http://localhost/api/sessions/${parent}/subagents`),
    { params: Promise.resolve({ id: parent }) },
  );
  expect(response.status).toBe(200);
  return await response.json() as {
    tasks: SubagentTaskSummary[];
    sessions: SubagentSessionStatsView[];
  };
}

let callSeq = 0;

function metric(sessionId: string, overrides: Partial<ModelCallInsert> = {}): ModelCallInsert {
  callSeq += 1;
  return {
    callId: `call-${callSeq}`,
    startedAt: 1_700_000_000_000 + callSeq,
    sessionId,
    messageId: String(callSeq),
    source: "subagent",
    purpose: "chat",
    provider: "anthropic",
    modelId: "claude-test",
    api: "test-api",
    status: "completed",
    ttftMs: 500,
    generationDurationMs: 1_000,
    durationMs: 2_000,
    outputTokens: 100,
    error: null,
    ...overrides,
  };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagent-sessions-api-"));
  agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  savedAgentDir = process.env.PI_CODING_AGENT_DIR;
  savedDataDir = process.env.PI_WORK_DATA_DIR;
  savedTokenAuditDb = process.env.PI_WORK_TOKEN_AUDIT_DB;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_WORK_DATA_DIR = dir;
  process.env.PI_WORK_TOKEN_AUDIT_DB = join(dir, "token-audit.db");
  process.env.PI_WORK_SUBAGENTS_DB = join(dir, "subagents.db");
  resetGlobals();
  GET = (await import("@/app/api/sessions/[id]/subagents/route")).GET;
});

afterAll(() => {
  resetGlobals();
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_WORK_DATA_DIR;
  delete process.env.PI_WORK_SUBAGENTS_DB;
  delete process.env.PI_WORK_TOKEN_AUDIT_DB;
  if (savedAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  if (savedDataDir !== undefined) process.env.PI_WORK_DATA_DIR = savedDataDir;
  if (savedTokenAuditDb !== undefined) process.env.PI_WORK_TOKEN_AUDIT_DB = savedTokenAuditDb;
  rmSync(dir, { recursive: true, force: true });
});

describe("/api/sessions/[id]/subagents sessions", () => {
  it("returns one session view for a reused child session while keeping every task", async () => {
    writeChildSession("child-reused");
    seedTask(DEFAULT_PARENT, "0001", "child-reused", "first pass");
    seedTask(DEFAULT_PARENT, "0002", "child-reused", "second pass");

    const body = await readRoute();

    expect(body.tasks.map((task) => task.taskId).sort()).toEqual(["0001", "0002"]);
    expect(body.tasks.every((task) => task.childSessionId === "child-reused")).toBe(true);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toEqual({
      sessionId: "child-reused",
      title: "summarize the repository",
      assistantCount: 2,
      toolCallCount: 1,
      avgTtftMs: null,
      avgGenerationTps: null,
      model: { provider: "anthropic", modelId: "claude-test" },
      context: null,
    });
  });

  it("keeps task-shaped fields for existing consumers", async () => {
    const body = await readRoute();
    const task = body.tasks.find((item) => item.taskId === "0002")!;
    const session = body.sessions.find((item) => item.sessionId === "child-reused")!;

    expect(task).toMatchObject({
      childSessionId: "child-reused",
      subagentName: "codebase_explorer",
      description: "second pass",
      status: "completed",
    });
    expect(task).not.toHaveProperty("assistantCount");
    expect(task).not.toHaveProperty("readCount");
    expect(task).not.toHaveProperty("model");
    expect(session).toMatchObject({
      assistantCount: 2,
      toolCallCount: 1,
      model: { provider: "anthropic", modelId: "claude-test" },
    });
    expect(task.startedAt).toBeTypeOf("number");
    expect(task.finishedAt).toBeTypeOf("number");
  });

  it("omits sessions that are not child sessions", async () => {
    seedTask(DEFAULT_PARENT, "0003", null, "waiting for a slot");

    const body = await readRoute();

    expect(body.tasks.map((task) => task.taskId).sort()).toEqual(["0001", "0002", "0003"]);
    expect(body.sessions.map((session) => session.sessionId)).toEqual(["child-reused"]);
  });
});

describe("/api/sessions/[id]/subagents session metrics", () => {
  it("counts every assistant message once and every tool call individually", async () => {
    const parent = "parent-message-counts";
    writeChildSession("child-counts", [
      {
        role: "user",
        timestamp: 1,
        content: [{ type: "text", text: "inspect the code" }],
      },
      {
        role: "assistant",
        timestamp: 2,
        provider: "anthropic",
        model: "claude-test",
        content: [{ type: "text", text: "plain reply" }],
      },
      {
        role: "assistant",
        timestamp: 3,
        provider: "anthropic",
        model: "claude-test",
        content: [
          { type: "text", text: "working" },
          { type: "toolCall", toolCallId: "t1", toolName: "read", input: { path: "/a.ts" } },
          { type: "toolCall", toolCallId: "t2", toolName: "bash", input: { command: "ls" } },
          { type: "toolCall", toolCallId: "t3", toolName: "grep", input: { pattern: "x" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        content: [{ type: "text", text: "contents" }],
      },
      {
        role: "user",
        timestamp: 5,
        content: [{ type: "text", text: "continue" }],
      },
    ]);
    seedTask(parent, "0001", "child-counts", "count everything");

    const body = await readRoute(parent);

    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].assistantCount).toBe(2);
    expect(body.sessions[0].toolCallCount).toBe(3);
    expect(body.sessions[0].model).toEqual({ provider: "anthropic", modelId: "claude-test" });
  });

  it("reads the session-level TTFT and generation TPS from the audit aggregate", async () => {
    const parent = "parent-audit-metrics";
    writeChildSession("child-audited");
    seedTask(parent, "0001", "child-audited", "measure it");
    recordModelCall(metric("child-audited", { ttftMs: 400, generationDurationMs: 1_000, outputTokens: 100 }));
    recordModelCall(metric("child-audited", { ttftMs: 800, generationDurationMs: 3_000, outputTokens: 300 }));

    const body = await readRoute(parent);

    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].avgTtftMs).toBe(600);
    expect(body.sessions[0].avgGenerationTps).toBeCloseTo(100, 10);
  });

  it("keeps a measured zero and reports unknown metrics as null", async () => {
    const parent = "parent-zero-vs-unknown";
    writeChildSession("child-zero");
    writeChildSession("child-unknown");
    seedTask(parent, "0001", "child-zero", "measured zero");
    seedTask(parent, "0002", "child-unknown", "never measured");
    recordModelCall(metric("child-zero", { ttftMs: 0, generationDurationMs: 1_000, outputTokens: 0 }));

    const body = await readRoute(parent);
    const zero = body.sessions.find((session) => session.sessionId === "child-zero")!;
    const unknown = body.sessions.find((session) => session.sessionId === "child-unknown")!;

    expect(zero.avgTtftMs).toBe(0);
    expect(zero.avgGenerationTps).toBe(0);
    expect(unknown.avgTtftMs).toBeNull();
    expect(unknown.avgGenerationTps).toBeNull();
  });
});
