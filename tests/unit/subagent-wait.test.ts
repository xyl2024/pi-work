import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setSubagentParentResolverForTests,
  subagentTool,
  type SubagentParentContext,
} from "@/lib/server/subagent-tool";
import {
  createChildSessionFactory,
  createFakeTimers,
  createScriptedRunner,
} from "./support/subagent-runtime";
import {
  createSubagentTaskManager,
  setSubagentTaskManagerForTests,
  type SubagentTaskManager,
} from "@/lib/server/subagent-tasks";
import {
  completeSubagentTask,
  createSubagentTask,
  failSubagentTask,
  markSubagentRunning,
  setSubagentTaskPartialOutput,
} from "@/lib/server/subagent-store";
import { DEFAULT_SUBAGENT_TIMEOUT_MS, DEFAULT_SUBAGENT_WAIT_MS } from "@/lib/shared/subagent";

let dir: string;

function resetGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.__piSubagentsDb;
  delete g.__piSubagentProfilesSeeded;
  delete g.__piSubagentTaskManager;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagent-wait-"));
  process.env.PI_WORK_SUBAGENTS_DB = join(dir, "subagents.db");
  process.env.PI_WORK_DATA_DIR = dir;
});

afterAll(() => {
  resetGlobals();
  delete process.env.PI_WORK_SUBAGENTS_DB;
  delete process.env.PI_WORK_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  resetGlobals();
});

afterEach(() => {
  setSubagentTaskManagerForTests(null);
  setSubagentParentResolverForTests(null);
});

type ExecuteContext = Parameters<NonNullable<typeof subagentTool.execute>>[4];
type ExecuteParams = Parameters<NonNullable<typeof subagentTool.execute>>[1];

function fakeContext(parentSessionId: string): ExecuteContext {
  return {
    cwd: "/tmp/work",
    sessionManager: { getSessionId: () => parentSessionId },
  } as unknown as ExecuteContext;
}

function parentContext(parentSessionId: string): SubagentParentContext {
  return {
    parentSessionId,
    model: { provider: "p", modelId: "m-parent" },
    systemPrompt: "parent prompt",
  };
}

async function run(
  params: ExecuteParams,
  parentSessionId: string,
  signal?: AbortSignal,
) {
  return subagentTool.execute!("call-1", params, signal, undefined, fakeContext(parentSessionId));
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((item) => (item.type === "text" ? item.text ?? "" : "")).join("\n");
}

function setup(parentSessionId: string) {
  const runner = createScriptedRunner();
  const timers = createFakeTimers();
  const manager: SubagentTaskManager = createSubagentTaskManager({
    runTurn: runner.runTurn,
    createChildSession: createChildSessionFactory().factory,
    timers: timers.timers,
  });
  setSubagentTaskManagerForTests(manager);
  setSubagentParentResolverForTests(async (id) => parentContext(id));
  return { runner, timers, manager, parentSessionId };
}

async function spawnTask(parentSessionId: string): Promise<string> {
  const spawned = await run(
    {
      action: "spawn",
      subagent_name: "codebase_explorer",
      description: "long job",
      prompt: "work",
      wait_ms: 0,
    },
    parentSessionId,
  );
  expect(spawned.isError).toBeUndefined();
  const details = spawned.details as { action: string; taskId: string };
  expect(details.action).toBe("spawn");
  return details.taskId;
}

function seedRow(input: {
  parent: string;
  child: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  result?: string;
  error?: string;
  description?: string;
}): string {
  const taskId = `subagent:seed-${Math.random().toString(36).slice(2)}`;
  createSubagentTask({
    taskId,
    parentSessionId: input.parent,
    subagentName: "codebase_explorer",
    description: input.description ?? "seeded",
    prompt: "the prompt",
  });
  if (input.child) markSubagentRunning(input.parent, taskId, input.child);
  if (input.status === "completed") completeSubagentTask(input.parent, taskId, input.result ?? "done");
  if (input.status === "failed" || input.status === "cancelled" || input.status === "interrupted") {
    failSubagentTask(input.parent, taskId, input.error ?? "stopped", input.status);
    if (input.result) setSubagentTaskPartialOutput(input.parent, taskId, input.result);
  }
  return taskId;
}

describe("subagent tool — wait action", () => {
  it("waits 15 minutes by default, then waits again and returns the final result", async () => {
    const { runner, timers, manager } = setup("parent-wait");
    const taskId = await spawnTask("parent-wait");
    expect(runner.turns).toHaveLength(1);
    await runner.turns[0].acquire();
    expect(runner.turns[0].spec.timeoutMs).toBe(DEFAULT_SUBAGENT_TIMEOUT_MS);

    const immediate = await run({ action: "wait", task_id: taskId, wait_ms: 0 }, "parent-wait");
    expect(immediate.details).toMatchObject({ status: "running", waitExpired: true });
    expect(timers.scheduled).toHaveLength(0);

    const waiting = run({ action: "wait", task_id: taskId }, "parent-wait");
    const deadline = timers.scheduled.find((timer) => !timer.cancelled)!;
    expect(deadline.ms).toBe(DEFAULT_SUBAGENT_WAIT_MS);
    deadline.fire();

    const observed = await waiting;
    expect(observed.isError).toBeUndefined();
    const details = observed.details as {
      action: string;
      taskId: string;
      status: string;
      waitExpired: boolean;
    };
    expect(details).toMatchObject({
      action: "wait",
      taskId,
      status: "running",
      waitExpired: true,
    });
    expect(textOf(observed)).toContain("still running");
    expect(textOf(observed)).toContain("not cancelled");
    expect(textOf(observed)).toContain(`action="wait", task_id="${taskId}"`);
    expect(manager.liveStatus("parent-wait", taskId)).toBe("running");
    expect(runner.turns).toHaveLength(1);

    await runner.turns[0].settle({ text: "final answer" });
    await manager.idle();

    const finished = await run({ action: "wait", task_id: taskId, wait_ms: 0 }, "parent-wait");
    expect(finished.isError).toBeUndefined();
    expect(finished.details).toMatchObject({
      action: "wait",
      taskId,
      status: "completed",
      waitExpired: false,
      result: "final answer",
    });
    expect(textOf(finished)).toContain("final answer");
    expect(runner.turns).toHaveLength(1);
  });

  it("lets several waiters observe one task without starting another turn", async () => {
    const { runner, timers, manager } = setup("parent-waiters");
    const taskId = await spawnTask("parent-waiters");
    await runner.turns[0].acquire();

    const first = run({ action: "wait", task_id: taskId, wait_ms: 500 }, "parent-waiters");
    const second = run({ action: "wait", task_id: taskId, wait_ms: 500 }, "parent-waiters");
    const deadlines = timers.scheduled.filter((timer) => !timer.cancelled && timer.ms === 500);
    expect(deadlines).toHaveLength(2);
    for (const deadline of deadlines) deadline.fire();

    const [a, b] = await Promise.all([first, second]);
    for (const observed of [a, b]) {
      expect(observed.details).toMatchObject({
        action: "wait",
        taskId,
        status: "running",
        waitExpired: true,
      });
    }
    expect(manager.liveStatus("parent-waiters", taskId)).toBe("running");
    expect(runner.turns).toHaveLength(1);

    await runner.turns[0].settle({ text: "shared answer" });
    await manager.idle();

    const finished = await run({ action: "wait", task_id: taskId, wait_ms: 0 }, "parent-waiters");
    expect(finished.details).toMatchObject({ status: "completed", result: "shared answer" });
    expect(runner.turns).toHaveLength(1);
  });

  it("returns a terminal task immediately, with its result, error and partial output", async () => {
    const { runner, timers } = setup("parent-terminal");

    const completed = seedRow({
      parent: "parent-terminal",
      child: "child-completed",
      status: "completed",
      result: "the answer",
    });
    const failed = seedRow({
      parent: "parent-terminal",
      child: "child-failed",
      status: "failed",
      error: "runtime limit reached",
      result: "partial text",
    });
    const cancelled = seedRow({
      parent: "parent-terminal",
      child: "child-cancelled",
      status: "cancelled",
      error: "Subagent cancelled",
    });
    const interrupted = seedRow({
      parent: "parent-terminal",
      child: "child-interrupted",
      status: "interrupted",
      error: "Interrupted: the server restarted",
    });

    const completedResult = await run({ action: "wait", task_id: completed, wait_ms: 0 }, "parent-terminal");
    expect(completedResult.details).toMatchObject({
      action: "wait",
      status: "completed",
      waitExpired: false,
      result: "the answer",
    });
    expect(textOf(completedResult)).toContain("the answer");

    const failedResult = await run({ action: "wait", task_id: failed, wait_ms: 0 }, "parent-terminal");
    expect(failedResult.details).toMatchObject({ status: "failed", error: "runtime limit reached" });
    expect(textOf(failedResult)).toContain("runtime limit reached");
    expect(textOf(failedResult)).toContain("Last partial output:");
    expect(textOf(failedResult)).toContain("partial text");

    for (const [taskId, status, error] of [
      [cancelled, "cancelled", "Subagent cancelled"],
      [interrupted, "interrupted", "Interrupted: the server restarted"],
    ] as const) {
      const terminal = await run({ action: "wait", task_id: taskId, wait_ms: 0 }, "parent-terminal");
      expect(terminal.details).toMatchObject({ status, error, waitExpired: false });
      expect(textOf(terminal)).toContain(error);
    }

    expect(timers.scheduled).toHaveLength(0);
    expect(runner.turns).toHaveLength(0);
  });

  it("targets the requested task, not a newer task of the same child session", async () => {
    setup("parent-target");
    const older = seedRow({
      parent: "parent-target",
      child: "child-shared",
      status: "completed",
      result: "older result",
    });
    seedRow({
      parent: "parent-target",
      child: "child-shared",
      status: "running",
      description: "newer task",
    });

    const observed = await run({ action: "wait", task_id: older, wait_ms: 0 }, "parent-target");
    expect(observed.details).toMatchObject({ taskId: older, status: "completed", result: "older result" });
    expect(textOf(observed)).toContain("older result");
  });

  it("reports a non-terminal row this process does not manage as interrupted", async () => {
    setup("parent-stale");
    const stale = seedRow({
      parent: "parent-stale",
      child: "child-stale",
      status: "running",
    });

    const observed = await run({ action: "wait", task_id: stale, wait_ms: 0 }, "parent-stale");
    expect(observed.details).toMatchObject({ action: "wait", status: "interrupted", waitExpired: false });
    expect(textOf(observed)).toContain("Subagent interrupted");
    expect(textOf(observed)).toContain("no longer managed");
    expect(textOf(observed)).not.toContain("Unknown error");
  });

  it("ends the observation on abort but does not stop the task", async () => {
    const { runner, timers, manager } = setup("parent-wait-abort");
    const taskId = await spawnTask("parent-wait-abort");
    await runner.turns[0].acquire();

    const controller = new AbortController();
    const waiting = run({ action: "wait", task_id: taskId, wait_ms: 1000 }, "parent-wait-abort", controller.signal);
    const deadline = timers.scheduled.find((timer) => !timer.cancelled && timer.ms === 1000)!;
    controller.abort();

    const observed = await waiting;
    expect(observed.details).toMatchObject({ status: "running", waitExpired: false });
    expect(textOf(observed)).toContain("wait was cancelled");
    expect(textOf(observed)).toContain("keeps running");
    expect(deadline.cancelled).toBe(true);
    expect(manager.liveStatus("parent-wait-abort", taskId)).toBe("running");
    expect(runner.turns).toHaveLength(1);
    await runner.turns[0].settle({ text: "survived" });
    await manager.idle();
  });

  it("reports a foreign or unknown task id as not found and leaves the task alone", async () => {
    const { runner, manager } = setup("parent-owner");
    const taskId = await spawnTask("parent-owner");
    await runner.turns[0].acquire();

    for (const lookup of [taskId, "subagent:missing"]) {
      const denied = await run({ action: "wait", task_id: lookup, wait_ms: 0 }, "parent-intruder");
      expect(denied.isError).toBe(true);
      expect(denied.details).toMatchObject({ action: "wait" });
      expect(textOf(denied)).toContain("No subagent task");
    }
    expect(manager.liveStatus("parent-owner", taskId)).toBe("running");
    expect(runner.turns).toHaveLength(1);

    const allowed = await run({ action: "wait", task_id: taskId, wait_ms: 0 }, "parent-owner");
    expect(allowed.isError).toBeUndefined();
  });

  it("requires a task_id and rejects arguments from other actions", async () => {
    setup("parent-params");

    const missing = await run({ action: "wait" } as ExecuteParams, "parent-params");
    expect(missing.isError).toBe(true);
    expect(missing.details).toMatchObject({ action: "wait" });
    expect(textOf(missing)).toContain("requires task_id");

    const foreign = await run(
      { action: "wait", task_id: "subagent:x", session_id: "child-1" } as ExecuteParams,
      "parent-params",
    );
    expect(foreign.isError).toBe(true);
    expect(textOf(foreign)).toContain("does not accept session_id");
  });
});
