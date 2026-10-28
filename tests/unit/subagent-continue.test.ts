import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
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
  getSubagentDb,
  getSubagentTask,
  listSubagentTasks,
  markSubagentRunning,
  type SubagentTask,
} from "@/lib/server/subagent-store";
import { createSubagentProfile, deleteSubagentProfile } from "@/lib/server/subagent-profiles";
import {
  DEFAULT_SUBAGENT_BOT,
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  DEFAULT_SUBAGENT_WAIT_MS,
  type SubagentTaskConfigSnapshot,
} from "@/lib/shared/subagent";

/**
 * `subagent` action `continue`: every continued delegation is a new task in an
 * existing child session, reusing the configuration frozen when that session
 * was created. Driven through the tool's external interface with the real task
 * manager, a scripted turn adapter and a temp data root, so the assertions are
 * about what the parent reads and what the persisted history/management says.
 */

let dir: string;

function resetGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.__piSubagentsDb;
  delete g.__piSubagentProfilesSeeded;
  delete g.__piSubagentTaskManager;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagent-continue-"));
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

async function run(params: ExecuteParams, parentSessionId: string) {
  return subagentTool.execute!("call-1", params, undefined, undefined, fakeContext(parentSessionId));
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((item) => (item.type === "text" ? item.text ?? "" : "")).join("\n");
}

function setup(parentSessionId: string, options: { maxConcurrent?: number } = {}) {
  const runner = createScriptedRunner();
  const timers = createFakeTimers();
  const child = createChildSessionFactory();
  const manager: SubagentTaskManager = createSubagentTaskManager({
    runTurn: runner.runTurn,
    createChildSession: child.factory,
    timers: timers.timers,
    ...(options.maxConcurrent !== undefined ? { maxConcurrent: options.maxConcurrent } : {}),
  });
  setSubagentTaskManagerForTests(manager);
  setSubagentParentResolverForTests(async (id) => parentContext(id));
  return { runner, timers, child, manager, parentSessionId };
}

const snapshot: SubagentTaskConfigSnapshot = {
  subagentName: "codebase_explorer",
  cwd: "/tmp/work",
  model: { provider: "p", modelId: "m-snapshot" },
  thinkingLevel: "high",
  tools: ["read"],
  systemPrompt: { kind: "prefix", text: "Explore only." },
  timeoutMs: 12_345,
};

/** Persist one finished task for an existing child session. */
function seedFinishedTask(input: {
  parent: string;
  child?: string;
  status: "completed" | "failed" | "cancelled" | "interrupted";
  result?: string;
  error?: string;
  description?: string;
  configSnapshot?: string | null;
  requestId?: string;
}): SubagentTask {
  const taskId = `subagent:seed-${Math.random().toString(36).slice(2)}`;
  const childSessionId = input.child ?? `child-${Math.random().toString(36).slice(2)}`;
  createSubagentTask({
    taskId,
    parentSessionId: input.parent,
    childSessionId,
    subagentName: "codebase_explorer",
    description: input.description ?? "seeded task",
    prompt: "first input",
    configSnapshot: input.configSnapshot === undefined ? JSON.stringify(snapshot) : input.configSnapshot,
    requestId: input.requestId,
  });
  markSubagentRunning(taskId, childSessionId);
  if (input.status === "completed") completeSubagentTask(taskId, input.result ?? "first answer");
  else failSubagentTask(taskId, input.error ?? input.status, input.status);
  return getSubagentTask(taskId)!;
}

async function spawnTask(parentSessionId: string, description = "first task"): Promise<string> {
  const spawned = await run(
    {
      action: "spawn",
      subagent_name: "codebase_explorer",
      description,
      prompt: "first input",
      wait_ms: 0,
    },
    parentSessionId,
  );
  expect(spawned.isError).toBeUndefined();
  return (spawned.details as { taskId: string }).taskId;
}

// ============================================================================

describe("subagent tool — continue action", () => {
  it("starts a new task in the same child session and keeps the earlier task intact", async () => {
    const { runner, manager } = setup("parent-continue");
    const firstId = await spawnTask("parent-continue");
    await runner.turns[0].acquire();
    const childSessionId = manager.get(firstId)!.childSessionId!;
    await runner.turns[0].settle({ text: "first answer" });
    await manager.idle();
    const before = getSubagentTask(firstId)!;

    const continued = await run(
      {
        action: "continue",
        session_id: childSessionId,
        prompt: "follow up",
        wait_ms: 0,
      },
      "parent-continue",
    );
    expect(continued.isError).toBeUndefined();
    const details = continued.details as {
      action: string;
      taskId: string;
      childSessionId: string | null;
      status: string;
      subagentName: string;
    };
    expect(details.action).toBe("continue");
    expect(details.taskId).not.toBe(firstId);
    expect(details.childSessionId).toBe(childSessionId);
    expect(details.subagentName).toBe("codebase_explorer");
    expect(details.status).not.toBe("completed");

    // A second turn runs in the same child session; its runtime limit is the
    // snapshot's and the model/thinking are re-applied from that snapshot.
    expect(runner.turns).toHaveLength(2);
    expect(runner.turns[1].spec.session).toEqual({ kind: "reuse", sessionId: childSessionId });
    expect(runner.turns[1].spec.timeoutMs).toBe(DEFAULT_SUBAGENT_TIMEOUT_MS);
    expect(runner.turns[1].spec.model).toEqual({ provider: "p", modelId: "m-parent" });
    expect(runner.turns[1].spec.thinkingLevel).toBe("off");
    expect(runner.turns[1].spec.prompt).toBe("follow up");

    await runner.turns[1].settle({ text: "second answer" });
    await manager.idle();

    const after = getSubagentTask(firstId)!;
    expect(after.prompt).toBe(before.prompt);
    expect(after.result).toBe("first answer");
    expect(after.status).toBe("completed");
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.finishedAt).toBe(before.finishedAt);

    const newest = getSubagentTask(details.taskId)!;
    expect(newest.childSessionId).toBe(childSessionId);
    expect(newest.prompt).toBe("follow up");
    expect(newest.result).toBe("second answer");
    expect(newest.status).toBe("completed");
  });

  it("uses the child session's creation-time snapshot, even if the profile is gone or changed", async () => {
    const { runner, child } = setup("parent-snapshot");
    const seeded = seedFinishedTask({ parent: "parent-snapshot", status: "completed" });

    const continued = await run(
      {
        action: "continue",
        session_id: seeded.childSessionId!,
        prompt: "use the frozen config",
        wait_ms: 0,
      },
      "parent-snapshot",
    );
    expect(continued.isError).toBeUndefined();

    // No profile lookup happened: `snapshot` names a model/limit the live
    // profile store never contained.
    expect(runner.turns[0].spec.timeoutMs).toBe(12_345);
    expect(runner.turns[0].spec.model).toEqual({ provider: "p", modelId: "m-snapshot" });
    expect(runner.turns[0].spec.thinkingLevel).toBe("high");
    await runner.turns[0].acquire();
    expect(child.created).toEqual([seeded.childSessionId]);
    const row = getSubagentTask((continued.details as { taskId: string }).taskId)!;
    const frozen = JSON.parse(row.configSnapshot!) as SubagentTaskConfigSnapshot;
    expect(frozen).toEqual(snapshot);
  });

  it("refuses a busy child session instead of queueing, steering or starting a second turn", async () => {
    const { runner, manager } = setup("parent-busy");
    const firstId = await spawnTask("parent-busy");
    await runner.turns[0].acquire();
    const childSessionId = manager.get(firstId)!.childSessionId!;

    const refused = await run(
      {
        action: "continue",
        session_id: childSessionId,
        prompt: "interrupt please",
        wait_ms: 0,
      },
      "parent-busy",
    );
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("busy");
    expect(runner.turns).toHaveLength(1);
    expect(listSubagentTasks("parent-busy")).toHaveLength(1);

    // The running task is untouched: same status, still alive.
    expect(manager.liveStatus(firstId)).toBe("running");
    await runner.turns[0].settle({ text: "first answer" });
    await manager.idle();

    const after = await run(
      {
        action: "continue",
        session_id: childSessionId,
        prompt: "now it is idle",
        wait_ms: 0,
      },
      "parent-busy",
    );
    expect(after.isError).toBeUndefined();
    expect(runner.turns).toHaveLength(2);
  });

  it("continues after success, failure, cancellation and interruption", async () => {
    const { runner, manager } = setup("parent-terminal-continue");
    const statuses = ["completed", "failed", "cancelled", "interrupted"] as const;
    for (const status of statuses) {
      const seeded = seedFinishedTask({
        parent: "parent-terminal-continue",
        status,
        result: status === "completed" ? "answer" : undefined,
        error: status === "completed" ? undefined : `ended: ${status}`,
      });
      const continued = await run(
        {
          action: "continue",
          session_id: seeded.childSessionId!,
          prompt: `continue after ${status}`,
          wait_ms: 0,
        },
        "parent-terminal-continue",
      );
      expect(continued.isError).toBeUndefined();
      expect((continued.details as { action: string }).action).toBe("continue");
      const taskId = (continued.details as { taskId: string }).taskId;
      expect(taskId).not.toBe(seeded.taskId);
      await runner.turns.at(-1)!.settle({ text: `after ${status}` });
      await manager.idle();
      expect(getSubagentTask(taskId)!.result).toBe(`after ${status}`);
      // The seeded row keeps its own terminal state and output.
      expect(getSubagentTask(seeded.taskId)!.status).toBe(status);
    }
  });

  it("waits 15 minutes by default, and a zero wait only ends the observation", async () => {
    const { runner, timers, manager } = setup("parent-continue-wait");
    const firstId = await spawnTask("parent-continue-wait");
    await runner.turns[0].acquire();
    const childSessionId = manager.get(firstId)!.childSessionId!;
    await runner.turns[0].settle({ text: "first answer" });
    await manager.idle();

    const immediate = await run(
      { action: "continue", session_id: childSessionId, prompt: "go", wait_ms: 0 },
      "parent-continue-wait",
    );
    expect(immediate.isError).toBeUndefined();
    expect(immediate.details).toMatchObject({ action: "continue", waitExpired: true });
    const taskId = (immediate.details as { taskId: string }).taskId;
    expect(timers.scheduled).toHaveLength(0);
    expect(manager.liveStatus(taskId)).not.toBeNull();
    await runner.turns[1].acquire();

    // A shorter wait is honoured for a continued task too: it only ends the
    // observation, the turn keeps running with its own runtime limit.
    const shortWait = run(
      { action: "wait", task_id: taskId, wait_ms: 500 },
      "parent-continue-wait",
    );
    const shortDeadline = timers.scheduled.find((timer) => !timer.cancelled && timer.ms === 500)!;
    expect(shortDeadline).toBeTruthy();
    shortDeadline.fire();
    const afterShort = await shortWait;
    expect(afterShort.details).toMatchObject({ status: "running", waitExpired: true });
    expect(manager.liveStatus(taskId)).toBe("running");

    const pendingWait = run(
      { action: "wait", task_id: taskId },
      "parent-continue-wait",
    );
    const deadline = timers.scheduled.find((timer) => !timer.cancelled && timer.ms === DEFAULT_SUBAGENT_WAIT_MS)!;
    expect(deadline).toBeTruthy();
    deadline.fire();
    const afterExpiry = await pendingWait;
    expect(afterExpiry.details).toMatchObject({ status: "running", waitExpired: true });
    expect(manager.liveStatus(taskId)).toBe("running");

    await runner.turns[1].settle({ text: "second answer" });
    await manager.idle();
    const finished = await run({ action: "wait", task_id: taskId, wait_ms: 0 }, "parent-continue-wait");
    expect(finished.details).toMatchObject({ status: "completed", result: "second answer" });
  });

  it("rejects continue while the parent's stop-all is in progress and allows it afterwards", async () => {
    const { runner, manager } = setup("parent-stopping");
    const firstId = await spawnTask("parent-stopping");
    await runner.turns[0].acquire();
    const childSessionId = manager.get(firstId)!.childSessionId!;

    manager.stopAll("parent-stopping");
    const refused = await run(
      { action: "continue", session_id: childSessionId, prompt: "during stop", wait_ms: 0 },
      "parent-stopping",
    );
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("stopping all subagent tasks");
    expect(listSubagentTasks("parent-stopping")).toHaveLength(1);

    await runner.turns[0].settle({ status: "cancelled", text: "", hasReply: false, error: "Subagent cancelled" });
    await manager.idle();
    expect(manager.isStopping("parent-stopping")).toBe(false);

    const allowed = await run(
      { action: "continue", session_id: childSessionId, prompt: "after stop", wait_ms: 0 },
      "parent-stopping",
    );
    expect(allowed.isError).toBeUndefined();
    await runner.turns[1].settle({ text: "resumed" });
    await manager.idle();
  });

  it("dedupes retried continue requests with request_id, but not two deliberate requests", async () => {
    const { runner, manager } = setup("parent-dedupe");
    const first = seedFinishedTask({ parent: "parent-dedupe", status: "completed" });

    const one = await run(
      {
        action: "continue",
        session_id: first.childSessionId!,
        prompt: "same input",
        wait_ms: 0,
        request_id: "req-1",
      },
      "parent-dedupe",
    );
    const two = await run(
      {
        action: "continue",
        session_id: first.childSessionId!,
        prompt: "same input",
        wait_ms: 0,
        request_id: "req-1",
      },
      "parent-dedupe",
    );
    expect((one.details as { taskId: string }).taskId).toBe((two.details as { taskId: string }).taskId);
    expect(runner.turns).toHaveLength(1);
    await runner.turns[0].settle({ text: "one" });
    await manager.idle();

    // A different deliberate request with identical content is a new task.
    const three = await run(
      {
        action: "continue",
        session_id: first.childSessionId!,
        prompt: "same input",
        wait_ms: 0,
      },
      "parent-dedupe",
    );
    expect((three.details as { taskId: string }).taskId).not.toBe((one.details as { taskId: string }).taskId);

    // A request id is scoped to its parent session: the same id elsewhere
    // never returns the first parent's task.
    const foreign = await run(
      {
        action: "spawn",
        subagent_name: "codebase_explorer",
        description: "other parent",
        prompt: "same input",
        wait_ms: 0,
        request_id: "req-1",
      },
      "parent-other",
    );
    expect(foreign.isError).toBeUndefined();
    expect((foreign.details as { taskId: string }).taskId).not.toBe((one.details as { taskId: string }).taskId);
  });

  it("keeps the dedupe record in the database across a manager restart", async () => {
    const { runner, manager } = setup("parent-restart");
    const first = seedFinishedTask({ parent: "parent-restart", status: "completed" });
    const original = await run(
      {
        action: "continue",
        session_id: first.childSessionId!,
        prompt: "survive a restart",
        wait_ms: 0,
        request_id: "req-restart",
      },
      "parent-restart",
    );
    const originalId = (original.details as { taskId: string }).taskId;
    await runner.turns[0].settle({ text: "done" });
    await manager.idle();

    // Simulate a new process: a fresh manager over the same temp database.
    setSubagentTaskManagerForTests(null);
    const restarted = createScriptedRunner();
    setSubagentTaskManagerForTests(createSubagentTaskManager({
      runTurn: restarted.runTurn,
      createChildSession: createChildSessionFactory().factory,
      timers: createFakeTimers().timers,
    }));

    const retried = await run(
      {
        action: "continue",
        session_id: first.childSessionId!,
        prompt: "survive a restart",
        wait_ms: 0,
        request_id: "req-restart",
      },
      "parent-restart",
    );
    expect(retried.isError).toBeUndefined();
    expect((retried.details as { taskId: string }).taskId).toBe(originalId);
    expect(restarted.turns).toHaveLength(0);
  });

  it("keeps multi-turn history readable through list/get and lets an old task be waited on", async () => {
    const { runner, manager } = setup("parent-history");
    const firstId = await spawnTask("parent-history");
    await runner.turns[0].acquire();
    const childSessionId = manager.get(firstId)!.childSessionId!;
    await runner.turns[0].settle({ text: "first answer" });
    await manager.idle();

    const continued = await run(
      { action: "continue", session_id: childSessionId, prompt: "follow up", wait_ms: 0 },
      "parent-history",
    );
    const secondId = (continued.details as { taskId: string }).taskId;
    await runner.turns[1].settle({ text: "second answer" });
    await manager.idle();

    const listed = await run({ action: "list" }, "parent-history");
    expect(listed.details).toMatchObject({ action: "list", total: 1 });
    expect((listed.details as { entries: Array<{ taskCount: number }> }).entries[0]!.taskCount).toBe(2);

    const history = await run({ action: "get", session_id: childSessionId }, "parent-history");
    expect(history.details).toMatchObject({ action: "get", target: "session" });
    expect((history.details as { tasks: { total: number; items: Array<{ taskId: string }> } }).tasks.total).toBe(2);
    expect((history.details as { tasks: { items: Array<{ taskId: string }> } }).tasks.items.map((item) => item.taskId))
      .toEqual([secondId, firstId]);

    const oldTask = await run({ action: "get", task_id: firstId }, "parent-history");
    expect(oldTask.details).toMatchObject({ target: "task" });
    expect((oldTask.details as { detail: { task: { resultLength: number } } }).detail.task.resultLength)
      .toBe("first answer".length);

    const waitedOld = await run({ action: "wait", task_id: firstId, wait_ms: 0 }, "parent-history");
    expect(waitedOld.details).toMatchObject({ taskId: firstId, status: "completed", result: "first answer" });
  });

  it("enforces ownership, argument validation and request-id scoping", async () => {
    setup("parent-owner");
    const foreign = seedFinishedTask({ parent: "other-parent", status: "completed" });

    const foreignContinue = await run(
      { action: "continue", session_id: foreign.childSessionId!, prompt: "steal", wait_ms: 0 },
      "parent-owner",
    );
    expect(foreignContinue.isError).toBe(true);
    expect(textOf(foreignContinue)).toContain("No subagent session");

    const missingPrompt = await run(
      { action: "continue", session_id: foreign.childSessionId!, wait_ms: 0 },
      "parent-owner",
    );
    expect(missingPrompt.isError).toBe(true);
    expect(textOf(missingPrompt)).toContain("requires prompt");

    const missingSession = await run(
      { action: "continue", prompt: "hello", wait_ms: 0 },
      "parent-owner",
    );
    expect(missingSession.isError).toBe(true);
    expect(textOf(missingSession)).toContain("requires session_id");

    // Request ids belong to one child session: reusing one for another session
    // is refused instead of returning/steering the wrong child.
    const own = seedFinishedTask({ parent: "parent-owner", status: "completed" });
    const own2 = seedFinishedTask({ parent: "parent-owner", status: "completed" });
    const first = await run(
      { action: "continue", session_id: own.childSessionId!, prompt: "one", wait_ms: 0, request_id: "scope" },
      "parent-owner",
    );
    expect(first.isError).toBeUndefined();
    const reused = await run(
      { action: "continue", session_id: own2.childSessionId!, prompt: "two", wait_ms: 0, request_id: "scope" },
      "parent-owner",
    );
    expect(reused.isError).toBe(true);
    expect(textOf(reused)).toContain("different subagent session");
  });

  it("does not let a late cancel of the old task touch the continued task", async () => {
    const { runner, manager } = setup("parent-old-cancel");
    const firstId = await spawnTask("parent-old-cancel");
    await runner.turns[0].acquire();
    const childSessionId = manager.get(firstId)!.childSessionId!;
    await runner.turns[0].settle({ text: "first answer" });
    await manager.idle();

    const continued = await run(
      { action: "continue", session_id: childSessionId, prompt: "second turn", wait_ms: 0 },
      "parent-old-cancel",
    );
    const secondId = (continued.details as { taskId: string }).taskId;

    const late = await run({ action: "cancel", task_id: firstId }, "parent-old-cancel");
    expect(late.details).toMatchObject({ taskId: firstId, status: "completed", requested: false });
    expect(manager.liveStatus(secondId)).not.toBeNull();
    expect(getSubagentTask(secondId)!.status).not.toBe("cancelled");

    await runner.turns[1].settle({ text: "second answer" });
    await manager.idle();
  });
});

describe("continue busy states and dedupe edge cases", () => {
  async function untilStarted(turns: unknown[], count: number): Promise<void> {
    for (let i = 0; i < 100 && turns.length < count; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(turns.length).toBeGreaterThanOrEqual(count);
  }

  it("treats queued, creating and stopping tasks as busy", async () => {
    const { runner, manager } = setup("parent-busy-states", { maxConcurrent: 1 });
    const blocker = await spawnTask("parent-busy-states", "blocker");
    await runner.turns[0].acquire();
    expect(manager.liveStatus(blocker)).toBe("running");

    const target = seedFinishedTask({ parent: "parent-busy-states", status: "completed" });
    const queued = await run(
      { action: "continue", session_id: target.childSessionId!, prompt: "queued turn", wait_ms: 0 },
      "parent-busy-states",
    );
    const targetTask = (queued.details as { taskId: string }).taskId;
    expect(manager.get(targetTask)!.status).toBe("queued");
    const busyQueued = await run(
      { action: "continue", session_id: target.childSessionId!, prompt: "should refuse", wait_ms: 0 },
      "parent-busy-states",
    );
    expect(busyQueued.isError).toBe(true);
    expect(textOf(busyQueued)).toContain("busy");

    // Release the slot: the queued continuation starts acquiring its session.
    await runner.turns[0].settle({ text: "blocker done" });
    await untilStarted(runner.turns, 2);
    expect(manager.get(targetTask)!.status).toBe("creating");
    const busyCreating = await run(
      { action: "continue", session_id: target.childSessionId!, prompt: "should refuse again", wait_ms: 0 },
      "parent-busy-states",
    );
    expect(busyCreating.isError).toBe(true);
    expect(textOf(busyCreating)).toContain("busy");

    await runner.turns[1].acquire();
    expect(manager.liveStatus(targetTask)).toBe("running");
    await run({ action: "cancel", task_id: targetTask }, "parent-busy-states");
    expect(manager.liveStatus(targetTask)).toBe("stopping");
    const busyStopping = await run(
      { action: "continue", session_id: target.childSessionId!, prompt: "should refuse while stopping", wait_ms: 0 },
      "parent-busy-states",
    );
    expect(busyStopping.isError).toBe(true);
    expect(textOf(busyStopping)).toContain("busy");

    await runner.turns[1].settle({ status: "cancelled", text: "", hasReply: false, error: "Subagent cancelled" });
    await manager.idle();
    expect(manager.liveStatus(targetTask)).toBeNull();
  });

  it("returns the original task when a spawn request is retried after its profile was deleted", async () => {
    const { runner } = setup("parent-spawn-retry");
    createSubagentProfile({
      name: "temp-worker",
      description: "temporary",
      systemPrompt: "Work only.",
      tools: ["read"],
      model: null,
      thinkingLevel: "off",
      bot: DEFAULT_SUBAGENT_BOT,
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      inheritSystemPrompt: false,
    });

    const first = await run(
      {
        action: "spawn",
        subagent_name: "temp-worker",
        description: "retry me",
        prompt: "same request",
        wait_ms: 0,
        request_id: "spawn-retry",
      },
      "parent-spawn-retry",
    );
    expect(first.isError).toBeUndefined();
    const firstId = (first.details as { taskId: string }).taskId;

    expect(deleteSubagentProfile("temp-worker")).toBe(true);
    const retried = await run(
      {
        action: "spawn",
        subagent_name: "temp-worker",
        description: "retry me",
        prompt: "same request",
        wait_ms: 0,
        request_id: "spawn-retry",
      },
      "parent-spawn-retry",
    );
    expect(retried.isError).toBeUndefined();
    expect((retried.details as { taskId: string }).taskId).toBe(firstId);
    expect(runner.turns).toHaveLength(1);

    // Reusing the id for a different request is refused instead of returning an
    // unrelated task.
    const mismatched = await run(
      {
        action: "spawn",
        subagent_name: "temp-worker",
        description: "different",
        prompt: "different request",
        wait_ms: 0,
        request_id: "spawn-retry",
      },
      "parent-spawn-retry",
    );
    expect(mismatched.isError).toBe(true);
    expect(textOf(mismatched)).toContain("different request");

    await runner.turns[0].settle({ text: "done" });
  });

  it("adds the request-id column and unique index to an old database idempotently", () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "pi-work-subagent-legacy-"));
    const legacyPath = join(legacyDir, "subagents.db");
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE subagent_tasks (
        task_id          TEXT PRIMARY KEY,
        parent_session_id TEXT NOT NULL,
        child_session_id TEXT,
        subagent_name    TEXT NOT NULL,
        description      TEXT NOT NULL,
        prompt           TEXT NOT NULL,
        status           TEXT NOT NULL,
        result           TEXT,
        error            TEXT,
        config_snapshot  TEXT,
        created_at       INTEGER NOT NULL,
        started_at       INTEGER,
        finished_at      INTEGER
      )
    `);
    legacy.prepare(`
      INSERT INTO subagent_tasks
        (task_id, parent_session_id, child_session_id, subagent_name, description, prompt, status, created_at)
      VALUES ('legacy-task', 'parent-legacy', 'child-legacy', 'codebase_explorer', 'old', 'old input', 'completed', 1)
    `).run();
    legacy.close();

    const previous = process.env.PI_WORK_SUBAGENTS_DB;
    delete (globalThis as { __piSubagentsDb?: unknown }).__piSubagentsDb;
    process.env.PI_WORK_SUBAGENTS_DB = legacyPath;
    try {
      const db = getSubagentDb();
      const columns = (db.prepare("PRAGMA table_info(subagent_tasks)").all() as Array<{ name: string }>)
        .map((column) => column.name);
      expect(columns).toContain("request_id");
      const indexes = (db.prepare("PRAGMA index_list(subagent_tasks)").all() as Array<{ name: string }>)
        .map((index) => index.name);
      expect(indexes).toContain("idx_subagent_tasks_request");
      // Existing rows stay readable and are simply not dedupe-able.
      expect(getSubagentTask("legacy-task")).toMatchObject({
        requestId: null,
        result: null,
        status: "completed",
      });
      // Re-opening (the migration runs again) is idempotent.
      expect(getSubagentDb()).toBe(db);
    } finally {
      delete (globalThis as { __piSubagentsDb?: unknown }).__piSubagentsDb;
      if (previous === undefined) delete process.env.PI_WORK_SUBAGENTS_DB;
      else process.env.PI_WORK_SUBAGENTS_DB = previous;
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});
