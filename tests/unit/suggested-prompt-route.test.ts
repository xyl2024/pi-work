import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getLlmAuditAls } from "@/lib/server/llm-audit";
import {
  suggestForSession,
  type SuggestedPromptGenerationOptions,
  type SuggestedPromptGenerator,
} from "@/lib/server/suggested-prompt";
import { createSubagentTask, markSubagentRunning } from "@/lib/server/subagent-store";
import { createTask, recordRunEnd, recordRunStart } from "@/lib/server/scheduler/store";
import { readConfig, writeConfig } from "@/lib/server/config";
import type { SuggestedPromptConfig } from "@/lib/shared/config-types";
import { POST as suggestRoute } from "@/app/api/sessions/[id]/suggest/route";

const created: string[] = [];
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
const savedDataDir = process.env.PI_WORK_DATA_DIR;

const timestamp = "2026-01-02T03:04:05.000Z";

function sandbox(): { agentDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "pi-work-suggested-prompt-"));
  created.push(root);
  const agentDir = path.join(root, "agent");
  mkdirSync(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_WORK_DATA_DIR = path.join(root, "data");
  return { agentDir };
}

function headerLine(id: string): string {
  return (
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      timestamp,
      cwd: "/tmp/project",
    }) + "\n"
  );
}

function writeSession(agentDir: string, id: string, lines: string[]): void {
  const dir = path.join(agentDir, "sessions", "--tmp-project--");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${id}.jsonl`), [headerLine(id), ...lines].join(""), "utf8");
}

function userLine(id: string, parentId: string | null, text: string): string {
  return (
    JSON.stringify({
      type: "message",
      id,
      parentId,
      timestamp,
      message: { role: "user", content: [{ type: "text", text }], timestamp: 0 },
    }) + "\n"
  );
}

function assistantLine(
  id: string,
  parentId: string | null,
  content: Array<Record<string, unknown>>,
  stopReason: string | undefined,
): string {
  return (
    JSON.stringify({
      type: "message",
      id,
      parentId,
      timestamp,
      message: {
        role: "assistant",
        content,
        model: "test-model",
        provider: "test-provider",
        stopReason,
      },
    }) + "\n"
  );
}

function textLine(id: string, parentId: string | null, text: string, stopReason = "stop"): string {
  return assistantLine(id, parentId, [{ type: "text", text }], stopReason);
}

function toolCallLine(id: string, parentId: string | null, text: string): string {
  return assistantLine(
    id,
    parentId,
    [
      { type: "text", text },
      { type: "toolCall", id: "call-1", name: "read_file", arguments: { path: "a.ts" } },
    ],
    "toolUse",
  );
}

interface RecordedCall {
  promptText: string;
  options: SuggestedPromptGenerationOptions;
  audit: ReturnType<ReturnType<typeof getLlmAuditAls>["getStore"]>;
}

function recordingGenerator(answer: string | (() => Promise<string>)): {
  generator: SuggestedPromptGenerator;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const generator: SuggestedPromptGenerator = async (promptText, options) => {
    calls.push({ promptText, options, audit: getLlmAuditAls().getStore() });
    return typeof answer === "string" ? answer : answer();
  };
  return { generator, calls };
}

function setSuggestedPromptConfig(patch: Partial<SuggestedPromptConfig>): void {
  writeConfig({
    ...readConfig(),
    suggested_prompt: { enabled: true, model: null, ...patch },
  });
}

function clearCaches(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.__piWorkConfigCache;
  delete g.__piSessionPathCache;
  delete g.__piSessionListCache;
  delete g.__piSessionListHeaderCache;
  delete g.__piSessionListInflight;
  delete g.__piSessionListHeaderInflight;
  delete g.__piSubagentsDb;
  delete g.__piSchedulerDb;
  delete g.__piSchedulerMigrated;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  if (savedDataDir === undefined) delete process.env.PI_WORK_DATA_DIR;
  else process.env.PI_WORK_DATA_DIR = savedDataDir;
  clearCaches();
});

const completedTurn = (agentDir: string, id = "session-1"): void => {
  writeSession(agentDir, id, [
    userLine("u1", null, "给这个接口加上重试"),
    toolCallLine("a1", "u1", "我先看看重试辅助函数"),
    textLine("a2", "a1", "重试已经加上，默认三次"),
  ]);
};

describe("suggestForSession", () => {
  it("returns a suggestion after a normally completed turn", async () => {
    const { agentDir } = sandbox();
    completedTurn(agentDir);
    const { generator } = recordingGenerator("那退避策略呢？");

    await expect(
      suggestForSession({ sessionId: "session-1", generate: generator }),
    ).resolves.toEqual({ kind: "suggestion", suggestion: "那退避策略呢？" });
  });

  it("feeds the whole active branch to the model with generation options pinned", async () => {
    const { agentDir } = sandbox();
    completedTurn(agentDir);
    const { generator, calls } = recordingGenerator("那退避策略呢？");

    await suggestForSession({ sessionId: "session-1", generate: generator });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.promptText).toContain("给这个接口加上重试");
    expect(call.promptText).toContain("重试已经加上，默认三次");
    expect(call.options).toMatchObject({ thinkingLevel: "off", timeoutMs: 10_000 });
    expect(call.options.systemPrompt).toContain("150");
  });

  it("honours an explicitly supplied leaf id over the session's own leaf", async () => {
    const { agentDir } = sandbox();
    writeSession(agentDir, "session-2", [
      userLine("u1", null, "给这个接口加上重试"),
      textLine("a1", "u1", "重试已经加上", "stop"),
      textLine("a2", "u1", "退避也加上了", "stop"),
    ]);
    const { generator, calls } = recordingGenerator("那退避策略呢？");

    await suggestForSession({ sessionId: "session-2", leafId: "a1", generate: generator });

    expect(calls[0].promptText).toContain("重试已经加上");
    expect(calls[0].promptText).not.toContain("退避也加上了");
  });

  it("keeps abandoned branch messages out of the model context", async () => {
    const { agentDir } = sandbox();
    writeSession(agentDir, "session-3", [
      userLine("u1", null, "给这个接口加上重试"),
      toolCallLine("a1", "u1", "先看看重试辅助函数"),
      textLine("a-abandoned", "a1", "放弃重试，改用降级方案"),
      textLine("a2", "a1", "重试已经加上"),
      userLine("u2", "a2", "那退避策略呢？"),
      textLine("a3", "u2", "退避也加上了"),
    ]);
    const { generator, calls } = recordingGenerator("要不要加个上限？");

    await suggestForSession({ sessionId: "session-3", generate: generator });

    expect(calls[0].promptText).not.toContain("放弃重试，改用降级方案");
    expect(calls[0].promptText).toContain("退避也加上了");
  });

  it.each([
    ["aborted", { stopReason: "aborted", text: "被中断的半截回答" }],
    ["truncated", { stopReason: "length", text: "被截断的半截回答" }],
    ["deferred", { stopReason: "deferred", text: "挂起的回答" }],
    ["errored", { stopReason: "error", text: "出错的回答" }],
    ["mid-turn", { stopReason: "toolUse", text: "还在调工具" }],
    ["empty", { stopReason: "stop", text: "" }],
  ])("generates nothing for a %s turn", async (_label, turn) => {
    const { agentDir } = sandbox();
    writeSession(agentDir, "session-4", [
      userLine("u1", null, "给这个接口加上重试"),
      textLine("a1", "u1", turn.text, turn.stopReason),
    ]);
    const { generator, calls } = recordingGenerator("不该出现");

    const outcome = await suggestForSession({ sessionId: "session-4", generate: generator });

    expect(outcome.kind).toBe("none");
    expect(calls).toHaveLength(0);
  });

  it("refuses a subagent child session by its stored task identity", async () => {
    const { agentDir } = sandbox();
    completedTurn(agentDir, "child-session");
    const task = createSubagentTask({
      parentSessionId: "parent-session",
      subagentName: "explorer",
      description: "look around",
      prompt: "look around",
    });
    markSubagentRunning("parent-session", task.taskId, "child-session");
    const { generator, calls } = recordingGenerator("不该出现");

    await expect(
      suggestForSession({ sessionId: "child-session", generate: generator }),
    ).resolves.toEqual({ kind: "none", reason: "subagent-session" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a scheduled task session by its stored run identity", async () => {
    const { agentDir } = sandbox();
    completedTurn(agentDir, "scheduled-session");
    const task = createTask({
      name: "nightly",
      cron: "0 0 * * *",
      cwd: tmpdir(),
      prompt: "do the thing",
    });
    const run = recordRunStart(task.id);
    recordRunEnd(run.id, { status: "success", sessionId: "scheduled-session" });
    const { generator, calls } = recordingGenerator("不该出现");

    await expect(
      suggestForSession({ sessionId: "scheduled-session", generate: generator }),
    ).resolves.toEqual({ kind: "none", reason: "scheduled-session" });
    expect(calls).toHaveLength(0);
  });

  it("reports a missing session instead of generating", async () => {
    sandbox();
    const { generator, calls } = recordingGenerator("不该出现");

    await expect(
      suggestForSession({ sessionId: "does-not-exist", generate: generator }),
    ).resolves.toEqual({ kind: "none", reason: "session-not-found" });
    expect(calls).toHaveLength(0);
  });

  it("degrades silently when generation times out, without retrying", async () => {
    const { agentDir } = sandbox();
    completedTurn(agentDir, "session-5");
    const { generator, calls } = recordingGenerator(() =>
      Promise.reject(new Error("LLM call timed out after 10000ms")),
    );

    await expect(
      suggestForSession({ sessionId: "session-5", generate: generator }),
    ).resolves.toEqual({ kind: "none", reason: "generation-failed" });
    expect(calls).toHaveLength(1);
  });

  it("degrades silently when the model has no good question", async () => {
    const { agentDir } = sandbox();
    completedTurn(agentDir, "session-6");
    const { generator } = recordingGenerator("");

    await expect(
      suggestForSession({ sessionId: "session-6", generate: generator }),
    ).resolves.toEqual({ kind: "none", reason: "empty-suggestion" });
  });

  it("drops a suggestion that exceeds the character limit instead of truncating it", async () => {
    const { agentDir } = sandbox();
    completedTurn(agentDir, "session-7");
    const { generator } = recordingGenerator("问".repeat(151));

    await expect(
      suggestForSession({ sessionId: "session-7", generate: generator }),
    ).resolves.toEqual({ kind: "none", reason: "suggestion-too-long" });
  });

  it("cleans markdown and quote noise from the suggestion", async () => {
    const { agentDir } = sandbox();
    completedTurn(agentDir, "session-8");
    const { generator } = recordingGenerator("**「那退避策略呢？」**");

    await expect(
      suggestForSession({ sessionId: "session-8", generate: generator }),
    ).resolves.toEqual({ kind: "suggestion", suggestion: "那退避策略呢？" });
  });

  it("answers the route with an empty suggestion when the turn did not end normally", async () => {
    const { agentDir } = sandbox();
    writeSession(agentDir, "session-10", [
      userLine("u1", null, "给这个接口加上重试"),
      textLine("a1", "u1", "被中断的半截回答", "aborted"),
    ]);

    const response = await suggestRoute(
      new Request("http://localhost:30143/api/sessions/session-10/suggest", { method: "POST" }),
      { params: Promise.resolve({ id: "session-10" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ suggestion: "" });
  });

  it("answers the route with 404 for an unknown session", async () => {
    sandbox();
    const response = await suggestRoute(
      new Request("http://localhost:30143/api/sessions/missing/suggest", { method: "POST" }),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
  });

  it("generates nothing when the feature is disabled in settings", async () => {
    const { agentDir } = sandbox();
    completedTurn(agentDir, "session-11");
    setSuggestedPromptConfig({ enabled: false });
    const { generator, calls } = recordingGenerator("不该出现");

    await expect(
      suggestForSession({ sessionId: "session-11", generate: generator }),
    ).resolves.toEqual({ kind: "none", reason: "disabled" });
    expect(calls).toHaveLength(0);
  });

  it("uses the configured generation model", async () => {
    const { agentDir } = sandbox();
    completedTurn(agentDir, "session-12");
    setSuggestedPromptConfig({
      model: { provider: "cheap-provider", modelId: "cheap-model" },
    });
    const { generator, calls } = recordingGenerator("那退避策略呢？");

    await suggestForSession({ sessionId: "session-12", generate: generator });

    expect(calls[0].options).toMatchObject({
      provider: "cheap-provider",
      modelId: "cheap-model",
    });
  });

  it("falls back to the global default model when none is configured", async () => {
    const { agentDir } = sandbox();
    completedTurn(agentDir, "session-13");
    setSuggestedPromptConfig({ model: null });
    const { generator, calls } = recordingGenerator("那退避策略呢？");

    await suggestForSession({ sessionId: "session-13", generate: generator });

    expect(calls[0].options).not.toHaveProperty("provider");
    expect(calls[0].options).not.toHaveProperty("modelId");
  });

  it("tags the generation call with the direct audit source and its own purpose", async () => {
    const { agentDir } = sandbox();
    completedTurn(agentDir, "session-9");
    const { generator, calls } = recordingGenerator("那退避策略呢？");

    await suggestForSession({ sessionId: "session-9", generate: generator });

    expect(calls[0].audit).toMatchObject({
      sessionId: "session-9",
      source: "direct",
      purpose: "suggested-prompt",
    });
  });
});
