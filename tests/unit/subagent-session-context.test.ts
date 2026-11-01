import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionWrapper } from "@/lib/server/rpc-manager";
import { getRpcSession, listRunningRpcSessions } from "@/lib/server/session-registry";
import {
  readStoredSessionContextUsage,
  readSubagentSessionContextUsage,
} from "@/lib/server/subagent-context-usage";
import { readSubagentSessionViews } from "@/lib/server/subagent-session-views";

let dir: string;
let agentDir: string;
let savedAgentDir: string | undefined;

const SESSION_DIR = "sessions/--tmp-project--";
const MODEL = { provider: "anthropic", modelId: "claude-sonnet-4-5" };
const MODEL_WINDOW = 200_000;

interface FixtureEntry {
  type: string;
  [key: string]: unknown;
}

function resetGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.__piSessionPathCache;
  delete g.__piSessionListCache;
  delete g.__piSessionListHeaderCache;
  delete g.__piSessionListInflight;
  delete g.__piSessionListHeaderInflight;
  delete g.__piSubagentStatsCache;
  delete g.__piSessions;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagent-context-"));
  agentDir = join(dir, "agent");
  mkdirSync(join(agentDir, SESSION_DIR), { recursive: true });
  savedAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_WORK_DATA_DIR = dir;
});

afterAll(() => {
  resetGlobals();
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_WORK_DATA_DIR;
  if (savedAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  resetGlobals();
});

afterEach(() => {
  resetGlobals();
});

function assistantMessage(options: { text?: string; usageTokens?: number | null } = {}): Record<string, unknown> {
  const usageTokens = options.usageTokens === undefined ? 12_000 : options.usageTokens;
  return {
    role: "assistant",
    api: "anthropic-messages",
    provider: MODEL.provider,
    model: MODEL.modelId,
    content: [{ type: "text", text: options.text ?? "done" }],
    stopReason: "stop",
    timestamp: 1,
    usage:
      usageTokens === null
        ? undefined
        : {
            input: usageTokens,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: usageTokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
  };
}

function writeSession(sessionId: string, entries: FixtureEntry[]): string {
  const header = JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-01-02T03:04:05.000Z",
    cwd: "/tmp/project",
  });
  let parentId: string | null = null;
  const lines = entries.map((entry, index) => {
    const id = `e${index}`;
    const line = JSON.stringify({
      ...entry,
      id,
      parentId,
      timestamp: new Date(Date.UTC(2026, 0, 2, 3, 4, 6 + index)).toISOString(),
    });
    parentId = id;
    return line;
  });
  writeFileSync(join(agentDir, SESSION_DIR, `${sessionId}.jsonl`), [header, ...lines].join("\n") + "\n", "utf8");
  resetGlobals();
  return sessionId;
}

function messageEntry(message: Record<string, unknown>): FixtureEntry {
  return { type: "message", message };
}

describe("readStoredSessionContextUsage", () => {
  it("anchors an ended session to its last provider usage and the model window", async () => {
    const sessionId = writeSession("child-usage", [
      { type: "model_change", provider: MODEL.provider, modelId: MODEL.modelId },
      messageEntry({ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }),
      messageEntry(assistantMessage({ usageTokens: 12_000 })),
    ]);

    const usage = await readStoredSessionContextUsage(sessionId);

    expect(usage).toEqual({
      tokens: 12_000,
      contextWindow: MODEL_WINDOW,
      percent: 6,
      stale: false,
    });
  });

  it("reports unknown tokens with a known window after compaction without a new usage", async () => {
    const sessionId = writeSession("child-compacted", [
      { type: "model_change", provider: MODEL.provider, modelId: MODEL.modelId },
      messageEntry({ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }),
      messageEntry(assistantMessage({ usageTokens: 50_000 })),
      {
        type: "compaction",
        summary: "summarized",
        firstKeptEntryId: "e1",
        tokensBefore: 50_000,
      },
      messageEntry({ role: "user", content: [{ type: "text", text: "continue" }], timestamp: 2 }),
    ]);

    const usage = await readStoredSessionContextUsage(sessionId);

    expect(usage).toEqual({
      tokens: null,
      contextWindow: MODEL_WINDOW,
      percent: null,
      stale: true,
    });
  });

  it("returns null when the model window cannot be resolved", async () => {
    const sessionId = writeSession("child-no-window", [
      { type: "model_change", provider: "ghost", modelId: "ghost-model" },
      messageEntry({ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }),
      messageEntry({
        ...assistantMessage({ usageTokens: 12_000 }),
        provider: "ghost",
        model: "ghost-model",
      }),
    ]);

    expect(await readStoredSessionContextUsage(sessionId)).toBeNull();
  });

  it("keeps a real zero distinct from unknown", async () => {
    const sessionId = writeSession("child-empty", [
      { type: "model_change", provider: MODEL.provider, modelId: MODEL.modelId },
    ]);

    const usage = await readStoredSessionContextUsage(sessionId);

    expect(usage).toEqual({ tokens: 0, contextWindow: MODEL_WINDOW, percent: 0, stale: false });
  });

  it("does not start a runtime for an ended session", async () => {
    const sessionId = writeSession("child-no-runtime", [
      { type: "model_change", provider: MODEL.provider, modelId: MODEL.modelId },
      messageEntry({ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }),
      messageEntry(assistantMessage({ usageTokens: 12_000 })),
    ]);

    await readStoredSessionContextUsage(sessionId);
    await readSubagentSessionContextUsage(sessionId);

    expect(getRpcSession(sessionId)).toBeUndefined();
    expect(listRunningRpcSessions()).toEqual([]);
  });
});

function liveWrapper(usage: { tokens: number | null; contextWindow: number; percent: number | null }): AgentSessionWrapper {
  return {
    getContextUsage: () => usage,
    isRunning: () => true,
  } as unknown as AgentSessionWrapper;
}

describe("readSubagentSessionContextUsage", () => {
  it("reuses the live runtime context usage for a running session", async () => {
    const sessionId = "child-live";
    globalThis.__piSessions = new Map([
      [sessionId, liveWrapper({ tokens: 1_000, contextWindow: MODEL_WINDOW, percent: 5 })],
    ]);

    expect(await readSubagentSessionContextUsage(sessionId)).toEqual({
      tokens: 1_000,
      contextWindow: MODEL_WINDOW,
      percent: 5,
      stale: false,
    });
  });

  it("marks a live session without a trustworthy token count as stale", async () => {
    const sessionId = "child-live-compacted";
    globalThis.__piSessions = new Map([
      [sessionId, liveWrapper({ tokens: null, contextWindow: MODEL_WINDOW, percent: null })],
    ]);

    expect(await readSubagentSessionContextUsage(sessionId)).toEqual({
      tokens: null,
      contextWindow: MODEL_WINDOW,
      percent: null,
      stale: true,
    });
  });
});

describe("readSubagentSessionViews", () => {
  it("builds one context per child session even when several tasks share it", async () => {
    const childSessionId = writeSession("child-shared", [
      { type: "model_change", provider: MODEL.provider, modelId: MODEL.modelId },
      messageEntry({ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }),
      messageEntry(assistantMessage({ usageTokens: 12_000 })),
    ]);

    const views = await readSubagentSessionViews([
      { taskId: "0001", childSessionId },
      { taskId: "0002", childSessionId },
    ]);

    expect(views).toHaveLength(1);
    expect(views[0].sessionId).toBe(childSessionId);
    expect(views[0].context).toEqual({
      tokens: 12_000,
      contextWindow: MODEL_WINDOW,
      percent: 6,
      stale: false,
    });
  });
});
