import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setSubagentParentResolverForTests,
  subagentTool,
  type SubagentParentContext,
} from "@/lib/server/subagent-tool";
import {
  setSubagentTaskManagerForTests,
  type SpawnSubagentTaskInput,
  type SubagentTaskManager,
  type SubagentTaskProgress,
  type SubagentTaskWaitResult,
  type WaitSubagentTaskOptions,
} from "@/lib/server/subagent-tasks";
import { DEFAULT_SUBAGENT_WAIT_MS } from "@/lib/shared/subagent";

/**
 * The tool's own external seam: `execute` is driven with a fake parent resolver
 * and a fake task manager, so the argument semantics (defaults, forwarding,
 * result wording) are asserted without a model, a session or a database.
 * Task lifecycle itself is covered by `subagent-tasks.test.ts`.
 */

let dir: string;

beforeAll(() => {
  // Profile lookups read the subagent DB; keep them out of the real data root.
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagent-tool-"));
  process.env.PI_WORK_SUBAGENTS_DB = join(dir, "subagents.db");
  process.env.PI_WORK_DATA_DIR = dir;
});

afterAll(() => {
  delete process.env.PI_WORK_SUBAGENTS_DB;
  delete process.env.PI_WORK_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

type ExecuteContext = Parameters<NonNullable<typeof subagentTool.execute>>[4];

function fakeContext(): ExecuteContext {
  // Only `cwd` and the session id are read by the tool. The full pi extension
  // context is not constructible here; the cast is confined to this helper.
  return {
    cwd: "/tmp/work",
    sessionManager: { getSessionId: () => "parent-1" },
  } as unknown as ExecuteContext;
}

function parentContext(overrides: Partial<SubagentParentContext> = {}): SubagentParentContext {
  return {
    parentSessionId: "parent-1",
    model: { provider: "p", modelId: "m-parent" },
    systemPrompt: "parent prompt",
    ...overrides,
  };
}

interface FakeManagerState {
  spawns: SpawnSubagentTaskInput[];
  waits: Array<{ taskId: string; options: WaitSubagentTaskOptions | undefined }>;
  progress?: (progress: SubagentTaskProgress) => void;
  waitResult: SubagentTaskWaitResult;
}

function fakeManager(waitResult: SubagentTaskWaitResult): { manager: SubagentTaskManager; state: FakeManagerState } {
  const state: FakeManagerState = { spawns: [], waits: [], waitResult };
  const manager: SubagentTaskManager = {
    spawn(input) {
      state.spawns.push(input);
      state.progress = input.onProgress;
      return {
        taskId: "subagent:fake",
        childSessionId: null,
        status: "queued",
        subagentName: input.config.subagentName,
        description: input.description,
      };
    },
    async wait(taskId, options) {
      state.waits.push({ taskId, options });
      return waitResult;
    },
    stop() {},
    get() {
      return null;
    },
    async idle() {},
  };
  return { manager, state };
}

function waitResult(overrides: Partial<SubagentTaskWaitResult> = {}): SubagentTaskWaitResult {
  return {
    taskId: "subagent:fake",
    childSessionId: "child-1",
    status: "running",
    subagentName: "codebase_explorer",
    description: "explore",
    waitExpired: true,
    result: null,
    error: null,
    createdAt: 1,
    startedAt: 2,
    finishedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  setSubagentTaskManagerForTests(null);
  setSubagentParentResolverForTests(null);
});

describe("subagent tool — spawn action", () => {
  it("reports an unknown profile by name without creating a task", async () => {
    setSubagentParentResolverForTests(async () => parentContext());
    const { manager, state } = fakeManager(waitResult());
    setSubagentTaskManagerForTests(manager);

    const result = await subagentTool.execute!(
      "call-1",
      { action: "spawn", subagent_name: "does_not_exist", description: "d", prompt: "p" },
      undefined,
      undefined,
      fakeContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].type === "text" ? result.content[0].text : "").toContain("does_not_exist");
    expect(state.spawns).toHaveLength(0);
  });

  it("forwards the resolved config and the default 15-minute wait, returning the live state", async () => {
    setSubagentParentResolverForTests(async () => parentContext());
    const { manager, state } = fakeManager(waitResult());
    setSubagentTaskManagerForTests(manager);

    const updates: unknown[] = [];
    const result = await subagentTool.execute!(
      "call-1",
      { action: "spawn", subagent_name: "codebase_explorer", description: "explore", prompt: "look around" },
      undefined,
      (update) => updates.push(update),
      fakeContext(),
    );

    expect(state.spawns).toHaveLength(1);
    const spawn = state.spawns[0];
    expect(spawn.parentSessionId).toBe("parent-1");
    expect(spawn.description).toBe("explore");
    expect(spawn.prompt).toBe("look around");
    expect(spawn.config.subagentName).toBe("codebase_explorer");
    // The profile names no model, so the parent's is inherited; the child
    // never gets the subagent tool itself.
    expect(spawn.config.model).toEqual({ provider: "p", modelId: "m-parent" });
    expect(spawn.config.tools).toContain("read");
    expect(spawn.config.tools).not.toContain("subagent");

    expect(state.waits).toHaveLength(1);
    expect(state.waits[0]).toMatchObject({ taskId: "subagent:fake" });
    expect(state.waits[0].options?.timeoutMs).toBe(DEFAULT_SUBAGENT_WAIT_MS);

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(text).toContain("still running");
    expect(text).toContain("subagent:fake");
    expect(text).toContain("child-1");
    expect(text).toContain("not cancelled");
    expect(result.details).toMatchObject({ action: "spawn", taskId: "subagent:fake", status: "running", waitExpired: true });
  });

  it("honours wait_ms = 0 and forwards the tool abort as a stop condition", async () => {
    setSubagentParentResolverForTests(async () => parentContext());
    const { manager, state } = fakeManager(waitResult({ status: "queued", childSessionId: null }));
    setSubagentTaskManagerForTests(manager);
    const controller = new AbortController();

    await subagentTool.execute!(
      "call-1",
      { action: "spawn", subagent_name: "codebase_explorer", description: "d", prompt: "p", wait_ms: 0 },
      controller.signal,
      undefined,
      fakeContext(),
    );

    expect(state.waits[0].options?.timeoutMs).toBe(0);
    expect(state.waits[0].options?.stopOnAbort?.signal).toBe(controller.signal);
    expect(state.waits[0].options?.stopOnAbort?.reason).toBeTruthy();
  });

  it("reports a completed task's result text", async () => {
    setSubagentParentResolverForTests(async () => parentContext());
    const { manager } = fakeManager(waitResult({ status: "completed", waitExpired: false, result: "the answer" }));
    setSubagentTaskManagerForTests(manager);

    const result = await subagentTool.execute!(
      "call-1",
      { action: "spawn", subagent_name: "codebase_explorer", description: "d", prompt: "p" },
      undefined,
      undefined,
      fakeContext(),
    );

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(text).toContain("Subagent completed");
    expect(text).toContain("the answer");
    expect(result.details).toMatchObject({ status: "completed", waitExpired: false, result: "the answer" });
  });

  it("keeps the stop/partial-output wording for a cancelled task", async () => {
    setSubagentParentResolverForTests(async () => parentContext());
    const { manager } = fakeManager(waitResult({
      status: "cancelled",
      waitExpired: false,
      error: "Subagent cancelled",
      result: "partial text",
    }));
    setSubagentTaskManagerForTests(manager);

    const result = await subagentTool.execute!(
      "call-1",
      { action: "spawn", subagent_name: "codebase_explorer", description: "d", prompt: "p" },
      undefined,
      undefined,
      fakeContext(),
    );

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(text).toContain("Subagent cancelled");
    expect(text).toContain("Last partial output:");
    expect(text).toContain("partial text");
  });

  it("surfaces a spawn failure (parent gone) as a tool error", async () => {
    setSubagentParentResolverForTests(async () => {
      throw new Error("Parent session is not running");
    });
    const { manager, state } = fakeManager(waitResult());
    setSubagentTaskManagerForTests(manager);

    const result = await subagentTool.execute!(
      "call-1",
      { action: "spawn", subagent_name: "codebase_explorer", description: "d", prompt: "p" },
      undefined,
      undefined,
      fakeContext(),
    );

    expect(result.isError).toBe(true);
    expect(state.spawns).toHaveLength(0);
    expect(result.details).toMatchObject({ status: "failed" });
  });

  it("publishes in-flight progress updates so the card can show the queued state", async () => {
    setSubagentParentResolverForTests(async () => parentContext());
    const { manager, state } = fakeManager(waitResult());
    setSubagentTaskManagerForTests(manager);
    const updates: Array<{ details?: unknown }> = [];

    await subagentTool.execute!(
      "call-1",
      { action: "spawn", subagent_name: "codebase_explorer", description: "d", prompt: "p" },
      undefined,
      (update) => updates.push(update as { details?: unknown }),
      fakeContext(),
    );

    state.progress?.({
      taskId: "subagent:fake",
      childSessionId: null,
      status: "queued",
      subagentName: "codebase_explorer",
      description: "d",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].details).toMatchObject({ status: "queued", childSessionId: null });
  });
});
