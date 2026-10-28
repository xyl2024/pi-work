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
  createSubagentTaskManager,
  setSubagentTaskManagerForTests,
  type SubagentChildSession,
  type SubagentTaskManager,
  type SubagentTaskTimers,
} from "@/lib/server/subagent-tasks";
import {
  completeSubagentTask,
  createSubagentTask,
  failSubagentTask,
  markSubagentRunning,
  setSubagentTaskPartialOutput,
} from "@/lib/server/subagent-store";
import type { RunTurnSpec, TurnResult, TurnSessionFactory } from "@/lib/server/turn";
import { DEFAULT_SUBAGENT_TIMEOUT_MS, DEFAULT_SUBAGENT_WAIT_MS } from "@/lib/shared/subagent";

/**
 * `subagent` action `wait`: re-observing an existing task by `task_id`.
 *
 * Driven through the tool's own external interface with the real task manager,
 * a scripted turn adapter and a fake timer, so every assertion is about what
 * the parent model reads (text + details) and whether a turn is actually still
 * alive. `wait` must never start, replay or cancel a task: a timed-out wait
 * ends only the observation, a terminal task answers at once, and a foreign
 * task id is reported as not found.
 */

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

// ---------------------------------------------------------------------------
// Scripted turn + child session + timer seams (the same shape the lifecycle
// tests use; nothing here reaches a real model or the real user data root).
// ---------------------------------------------------------------------------

interface ScriptedTurn {
  spec: RunTurnSpec;
  settle(result?: Partial<TurnResult>): Promise<void>;
  acquire(): Promise<void>;
}

function createScriptedRunner() {
  const turns: ScriptedTurn[] = [];
  const completedResult = (): TurnResult => ({
    status: "completed",
    text: "done",
    hasReply: true,
    error: null,
    stopReason: "end_turn",
    sessionId: "child-key",
    realSessionId: `child-${turns.length}`,
  });

  const runTurn = async (spec: RunTurnSpec, createSession: TurnSessionFactory): Promise<TurnResult> => {
    let resolveTurn: (result: TurnResult) => void = () => {};
    const result = new Promise<TurnResult>((resolve) => {
      resolveTurn = resolve;
    });
    const turn: ScriptedTurn = {
      spec,
      acquire: async () => {
        await createSession(spec.cwd, undefined, "subagent", { kind: "fresh" });
      },
      settle: async (overrides: Partial<TurnResult> = {}) => {
        resolveTurn({ ...completedResult(), ...overrides, realSessionId: `child-${turns.length}` });
        await result;
      },
    };
    turns.push(turn);
    return await result;
  };

  return { turns, runTurn };
}

function fakeChildSession(realSessionId: string): SubagentChildSession {
  const manager = {
    appendSessionInfo: () => undefined,
    appendCustomEntry: () => undefined,
  };
  return {
    sessionId: realSessionId,
    inner: { sessionManager: manager },
    onEvent: () => () => {},
    onDestroy: () => () => {},
    send: async () => null,
    destroy: () => {},
  };
}

function createChildSessionFactory() {
  const factory = async (input: { taskId: string }) => {
    const realSessionId = `child-${input.taskId.slice(-4)}`;
    return { session: fakeChildSession(realSessionId), sessionId: realSessionId, realSessionId };
  };
  return factory;
}

interface ScheduledTimer {
  ms: number;
  cancelled: boolean;
  fire: () => void;
}

function createFakeTimers() {
  const scheduled: ScheduledTimer[] = [];
  const timers: SubagentTaskTimers = {
    setTimeout: (callback, ms) => {
      const record: ScheduledTimer = { ms, cancelled: false, fire: callback };
      scheduled.push(record);
      return record;
    },
    clearTimeout: (handle) => {
      (handle as ScheduledTimer).cancelled = true;
    },
  };
  return { scheduled, timers };
}

function setup(parentSessionId: string) {
  const runner = createScriptedRunner();
  const timers = createFakeTimers();
  const manager: SubagentTaskManager = createSubagentTaskManager({
    runTurn: runner.runTurn,
    createChildSession: createChildSessionFactory(),
    timers: timers.timers,
  });
  setSubagentTaskManagerForTests(manager);
  setSubagentParentResolverForTests(async (id) => parentContext(id));
  return { runner, timers, manager, parentSessionId };
}

/** Create a task through `spawn` with `wait_ms: 0`; returns its stable id. */
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

/** Seed a persisted row directly, for terminal / stale-row cases. */
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
  if (input.child) markSubagentRunning(taskId, input.child);
  if (input.status === "completed") completeSubagentTask(taskId, input.result ?? "done");
  if (input.status === "failed" || input.status === "cancelled" || input.status === "interrupted") {
    failSubagentTask(taskId, input.error ?? "stopped", input.status);
    if (input.result) setSubagentTaskPartialOutput(taskId, input.result);
  }
  return taskId;
}

// ============================================================================

describe("subagent tool — wait action", () => {
  it("waits 15 minutes by default, then waits again and returns the final result", async () => {
    const { runner, timers, manager } = setup("parent-wait");
    const taskId = await spawnTask("parent-wait");
    expect(runner.turns).toHaveLength(1);
    // Start the turn so the wait observes a real `running` task. The runtime
    // limit is the profile's, set when the turn starts — waiting never changes
    // it.
    await runner.turns[0].acquire();
    expect(runner.turns[0].spec.timeoutMs).toBe(DEFAULT_SUBAGENT_TIMEOUT_MS);

    // wait_ms = 0 is an immediate status snapshot, not a timeout of the task.
    const immediate = await run({ action: "wait", task_id: taskId, wait_ms: 0 }, "parent-wait");
    expect(immediate.details).toMatchObject({ status: "running", waitExpired: true });
    expect(timers.scheduled).toHaveLength(0);

    const waiting = run({ action: "wait", task_id: taskId }, "parent-wait");
    // The default wait is the spawn default; the timer is the only evidence the
    // caller asked the manager to observe, and firing it simulates the deadline.
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
    // The expiry ended only the observation: the turn is alive, its slot is
    // still held and no replacement task was created.
    expect(manager.liveStatus(taskId)).toBe("running");
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
    // A wait on an already-finished task does not create or replay a turn.
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
    expect(manager.liveStatus(taskId)).toBe("running");
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

    // Every other terminal status also answers at once, with its own error.
    for (const [taskId, status, error] of [
      [cancelled, "cancelled", "Subagent cancelled"],
      [interrupted, "interrupted", "Interrupted: the server restarted"],
    ] as const) {
      const terminal = await run({ action: "wait", task_id: taskId, wait_ms: 0 }, "parent-terminal");
      expect(terminal.details).toMatchObject({ status, error, waitExpired: false });
      expect(textOf(terminal)).toContain(error);
    }

    // No wait deadline was ever scheduled and no turn was started or replayed.
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
    // Same child session, a later task: `wait` must not drift to it.
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

    // The abort ends the wait promptly (no need to fire the deadline) and the
    // task is still running.
    const observed = await waiting;
    expect(observed.details).toMatchObject({ status: "running", waitExpired: false });
    expect(textOf(observed)).toContain("wait was cancelled");
    expect(textOf(observed)).toContain("keeps running");
    expect(deadline.cancelled).toBe(true);
    expect(manager.liveStatus(taskId)).toBe("running");
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
    // Ownership is checked before the manager is involved: the real owner's
    // task is untouched and still running.
    expect(manager.liveStatus(taskId)).toBe("running");
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
