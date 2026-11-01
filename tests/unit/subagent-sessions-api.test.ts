import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  completeSubagentTask,
  createSubagentTask,
  markSubagentRunning,
} from "@/lib/server/subagent-store";
import type { SubagentSessionStatsView, SubagentTaskSummary } from "@/lib/shared/types";

let dir: string;
let agentDir: string;
let savedAgentDir: string | undefined;
let savedDataDir: string | undefined;
let GET: typeof import("@/app/api/sessions/[id]/subagents/route")["GET"];

function resetGlobals(): void {
  const g = globalThis as Record<string, unknown>;
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

function writeChildSession(sessionId: string): void {
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
      message: {
        role: "user",
        timestamp: 1,
        content: [{ type: "text", text: "summarize the repository" }],
      },
    },
    {
      type: "message",
      id: "e1",
      parentId: "e0",
      timestamp: "2026-01-02T03:04:07.000Z",
      message: {
        role: "assistant",
        timestamp: 2,
        provider: "anthropic",
        model: "claude-test",
        content: [{ type: "text", text: "looking around" }],
      },
    },
    {
      type: "message",
      id: "e2",
      parentId: "e1",
      timestamp: "2026-01-02T03:04:08.000Z",
      message: {
        role: "assistant",
        timestamp: 3,
        provider: "anthropic",
        model: "claude-test",
        content: [
          { type: "text", text: "found it" },
          { type: "toolCall", toolCallId: "t1", toolName: "read", input: { path: "/a.ts" } },
        ],
      },
    },
  ].map((entry) => JSON.stringify(entry) + "\n");
  writeFileSync(join(sessionDir, `${sessionId}.jsonl`), [header, ...entries].join(""), "utf8");
  resetGlobals();
}

function seedTask(taskId: string, childSessionId: string | null, description: string): void {
  const parent = "parent-sessions-api";
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

async function readRoute(): Promise<{
  tasks: SubagentTaskSummary[];
  sessions: SubagentSessionStatsView[];
}> {
  const response = await GET(
    new Request("http://localhost/api/sessions/parent-sessions-api/subagents"),
    { params: Promise.resolve({ id: "parent-sessions-api" }) },
  );
  expect(response.status).toBe(200);
  return await response.json() as {
    tasks: SubagentTaskSummary[];
    sessions: SubagentSessionStatsView[];
  };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagent-sessions-api-"));
  agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  savedAgentDir = process.env.PI_CODING_AGENT_DIR;
  savedDataDir = process.env.PI_WORK_DATA_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_WORK_DATA_DIR = dir;
  process.env.PI_WORK_SUBAGENTS_DB = join(dir, "subagents.db");
  resetGlobals();
  GET = (await import("@/app/api/sessions/[id]/subagents/route")).GET;
});

afterAll(() => {
  resetGlobals();
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_WORK_DATA_DIR;
  delete process.env.PI_WORK_SUBAGENTS_DB;
  if (savedAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  if (savedDataDir !== undefined) process.env.PI_WORK_DATA_DIR = savedDataDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("/api/sessions/[id]/subagents sessions", () => {
  it("returns one session view for a reused child session while keeping every task", async () => {
    writeChildSession("child-reused");
    seedTask("0001", "child-reused", "first pass");
    seedTask("0002", "child-reused", "second pass");

    const body = await readRoute();

    expect(body.tasks.map((task) => task.taskId).sort()).toEqual(["0001", "0002"]);
    expect(body.tasks.every((task) => task.childSessionId === "child-reused")).toBe(true);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toEqual({
      sessionId: "child-reused",
      title: "summarize the repository",
      assistantCount: 2,
      toolCallCount: null,
      avgTtftMs: null,
      avgGenerationTps: null,
      model: { provider: null, modelId: "claude-test" },
      context: null,
    });
  });

  it("keeps task-shaped fields for existing consumers", async () => {
    const body = await readRoute();
    const task = body.tasks.find((item) => item.taskId === "0002")!;

    expect(task).toMatchObject({
      childSessionId: "child-reused",
      subagentName: "codebase_explorer",
      description: "second pass",
      status: "completed",
      assistantCount: 2,
      model: "claude-test",
    });
    expect(task.readCount).toBeTypeOf("number");
    expect(task.startedAt).toBeTypeOf("number");
    expect(task.finishedAt).toBeTypeOf("number");
  });

  it("omits sessions that are not child sessions", async () => {
    seedTask("0003", null, "waiting for a slot");

    const body = await readRoute();

    expect(body.tasks.map((task) => task.taskId).sort()).toEqual(["0001", "0002", "0003"]);
    expect(body.sessions.map((session) => session.sessionId)).toEqual(["child-reused"]);
  });
});
