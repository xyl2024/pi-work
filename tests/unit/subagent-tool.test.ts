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
import {
  completeSubagentTask,
  createSubagentTask,
  markSubagentRunning,
} from "@/lib/server/subagent-store";
import { DEFAULT_SUBAGENT_WAIT_MS, SUBAGENT_RESULT_WINDOW_DEFAULT } from "@/lib/shared/subagent";
import type { SubagentTaskStatus } from "@/lib/shared/types";

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

function fakeContext(parentSessionId = "parent-1"): ExecuteContext {
  // Only `cwd` and the session id are read by the tool. The full pi extension
  // context is not constructible here; the cast is confined to this helper.
  return {
    cwd: "/tmp/work",
    sessionManager: { getSessionId: () => parentSessionId },
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
  live: Map<string, SubagentTaskStatus>;
}

function fakeManager(waitResult: SubagentTaskWaitResult): { manager: SubagentTaskManager; state: FakeManagerState } {
  const state: FakeManagerState = { spawns: [], waits: [], waitResult, live: new Map() };
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
    continue() {
      throw new Error("continue is not used by this fake");
    },
    stop() {},
    stopAll() {
      return { stopped: 0, stopping: false };
    },
    isStopping() {
      return false;
    },
    get() {
      return null;
    },
    liveStatus(taskId) {
      return state.live.get(taskId) ?? null;
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

// ============================================================================
// list / get — the read side of the tool
//
// Rows are seeded straight into the temp subagents DB and the fake manager only
// answers "is this task live?"; the assertions stay on the tool's own result
// (text + details), which is what the parent model actually reads.
// ============================================================================

type ExecuteParams = Parameters<NonNullable<typeof subagentTool.execute>>[1];

async function run(params: ExecuteParams, parentSessionId = "parent-1") {
  return subagentTool.execute!("call-1", params, undefined, undefined, fakeContext(parentSessionId));
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((item) => (item.type === "text" ? item.text ?? "" : "")).join("\n");
}

function seedToolTask(input: {
  parent?: string;
  child?: string | null;
  status?: "queued" | "running" | "completed";
  description?: string;
  result?: string;
}): string {
  const taskId = `subagent:${Math.random().toString(36).slice(2)}`;
  createSubagentTask({
    taskId,
    parentSessionId: input.parent ?? "parent-1",
    subagentName: "codebase_explorer",
    description: input.description ?? "explore",
    prompt: "the prompt",
  });
  const status = input.status ?? "running";
  if (input.child && status !== "queued") markSubagentRunning(taskId, input.child);
  if (status === "completed") completeSubagentTask(taskId, input.result ?? "done");
  return taskId;
}

describe("subagent tool — list action", () => {
  it("lists one row per child session with its newest task and marks the next page", async () => {
    const { manager, state } = fakeManager(waitResult());
    setSubagentTaskManagerForTests(manager);
    seedToolTask({ parent: "parent-list", child: "child-1", status: "completed", description: "older" });
    const liveTask = seedToolTask({ parent: "parent-list", child: "child-2", description: "live one" });
    state.live.set(liveTask, "running");

    const result = await run({ action: "list", limit: 1 }, "parent-list");

    expect(result.isError).toBeUndefined();
    const details = result.details as { action: string; total: number; hasMore: boolean; entries: Array<{ sessionId: string | null }> };
    expect(details.action).toBe("list");
    expect(details.total).toBe(2);
    expect(details.hasMore).toBe(true);
    expect(details.entries[0].sessionId).toBe("child-2");
    const text = textOf(result);
    expect(text).toContain("1-1 of 2");
    expect(text).toContain("child-2");
    expect(text).toContain("live one");
    expect(text).toContain('offset=1');
    expect(state.spawns).toHaveLength(0);
  });

  it("filters by status and returns the requested page", async () => {
    const { manager } = fakeManager(waitResult());
    setSubagentTaskManagerForTests(manager);
    seedToolTask({ parent: "parent-list-page", child: "child-done", status: "completed", description: "done" });
    seedToolTask({ parent: "parent-list-page", child: "child-other", status: "completed", description: "other" });

    const filtered = await run({ action: "list", status: "failed" }, "parent-list-page");
    expect(textOf(filtered)).toContain("No subagent sessions of this session with status=failed");
    expect((filtered.details as { entries: unknown[] }).entries).toHaveLength(0);

    const page = await run({ action: "list", limit: 1, offset: 1 }, "parent-list-page");
    const details = page.details as { entries: Array<{ sessionId: string | null }>; hasMore: boolean };
    expect(details.entries.map((entry) => entry.sessionId)).toEqual(["child-done"]);
    expect(details.hasMore).toBe(false);
    expect(textOf(page)).toContain("That is the last page.");
  });
});

describe("subagent tool — get action", () => {
  it("reads one task with a bounded result window and the offset that continues it", async () => {
    const { manager } = fakeManager(waitResult());
    setSubagentTaskManagerForTests(manager);
    const resultText = "r".repeat(SUBAGENT_RESULT_WINDOW_DEFAULT + 30);
    const taskId = seedToolTask({ parent: "parent-get", child: "child-get", status: "completed", result: resultText });

    const first = await run({ action: "get", task_id: taskId }, "parent-get");
    const details = first.details as { action: string; detail: { result: { truncated: boolean; nextOffset: number | null; text: string } } };
    expect(details.action).toBe("get");
    expect(details.detail.result.truncated).toBe(true);
    expect(details.detail.result.nextOffset).toBe(SUBAGENT_RESULT_WINDOW_DEFAULT);
    expect(textOf(first)).toContain(`result_offset=${SUBAGENT_RESULT_WINDOW_DEFAULT}`);
    expect(textOf(first)).toContain("truncated");

    const rest = await run({ action: "get", task_id: taskId, result_offset: SUBAGENT_RESULT_WINDOW_DEFAULT }, "parent-get");
    expect(textOf(rest)).not.toContain("read the rest");
    expect(details.detail.result.text).toHaveLength(SUBAGENT_RESULT_WINDOW_DEFAULT);
  });

  it("reads one session: newest task detail plus its task history page", async () => {
    const { manager } = fakeManager(waitResult());
    setSubagentTaskManagerForTests(manager);
    seedToolTask({ parent: "parent-get-session", child: "child-hist", status: "completed", description: "older", result: "old" });
    seedToolTask({ parent: "parent-get-session", child: "child-hist", status: "completed", description: "newest", result: "fresh" });

    const result = await run({ action: "get", session_id: "child-hist", limit: 1 }, "parent-get-session");
    const text = textOf(result);
    expect(text).toContain("Subagent session child-hist");
    expect(text).toContain("newest");
    expect(text).toContain("task history (1-1 of 2");
    expect(text).toContain('session_id="child-hist", offset=1');
    const details = result.details as { target: string; tasks: { hasMore: boolean } };
    expect(details.target).toBe("session");
    expect(details.tasks.hasMore).toBe(true);
  });

  it("reports a foreign or unknown task id as a tool error", async () => {
    const { manager } = fakeManager(waitResult());
    setSubagentTaskManagerForTests(manager);
    const foreign = seedToolTask({ parent: "parent-owner", child: "child-owner", status: "completed" });

    for (const taskId of [foreign, "subagent:missing"]) {
      const result = await run({ action: "get", task_id: taskId }, "parent-intruder");
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("No subagent task");
    }
  });

  it("reports a foreign session id as a tool error", async () => {
    const { manager } = fakeManager(waitResult());
    setSubagentTaskManagerForTests(manager);
    seedToolTask({ parent: "parent-owner-2", child: "child-owner-2", status: "completed" });

    const result = await run({ action: "get", session_id: "child-owner-2" }, "parent-intruder-2");
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No subagent session");
  });
});

describe("subagent tool — per-action parameter validation", () => {
  it("requires exactly one lookup id for get", async () => {
    const missing = await run({ action: "get" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain("exactly one of task_id or session_id");

    const both = await run({ action: "get", task_id: "a", session_id: "b" });
    expect(both.isError).toBe(true);
    expect(textOf(both)).toContain("not both");
  });

  it("rejects arguments that belong to another action", async () => {
    const result = await run({ action: "list", prompt: "not a list argument" } as ExecuteParams);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("does not accept prompt");
  });

  it("still reports a missing spawn argument through the spawn envelope", async () => {
    const result = await run({ action: "spawn", description: "d", prompt: "p" } as ExecuteParams);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("requires subagent_name");
    expect((result.details as { action: string }).action).toBe("spawn");
  });
});

describe("subagent tool — read guidance", () => {
  it("points back to a valid window when result_offset is past the end", async () => {
    const { manager } = fakeManager(waitResult());
    setSubagentTaskManagerForTests(manager);
    const taskId = seedToolTask({ parent: "parent-overshoot", child: "child-overshoot", status: "completed", result: "short" });

    const result = await run({ action: "get", task_id: taskId, result_offset: 999 }, "parent-overshoot");
    expect(textOf(result)).toContain("at/after the end");
    expect(textOf(result)).toContain("result_offset=0");
  });

  it("rejects paging arguments on a task lookup", async () => {
    const result = await run({ action: "get", task_id: "subagent:x", limit: 5 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("drop them when using task_id");
  });
});
