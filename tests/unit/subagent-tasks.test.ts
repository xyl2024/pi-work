import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createChildSessionFactory,
  createFakeTimers,
  createScriptedRunner,
} from "./support/subagent-runtime";
import {
  createSubagentTaskManager,
  resolveSubagentTaskConfig,
  type SubagentTaskManager,
  type SubagentTaskManagerDeps,
} from "@/lib/server/subagent-tasks";
import type { SubagentProfile, SubagentTaskConfigSnapshot } from "@/lib/shared/subagent";
import { DEFAULT_SUBAGENT_WAIT_MS } from "@/lib/shared/subagent";
import {
  createSubagentTask,
  getSubagentTask,
  markSubagentRunning,
  type SubagentTask,
} from "@/lib/server/subagent-store";

/**
 * Lifecycle tests for the subagent task manager, driven through its external
 * interface (`spawn` / `wait` / `stop`) with a scripted turn adapter standing in
 * for a real model request and a fake child session; persistence uses a temp
 * data root. Nothing here asserts private containers: only the returned
 * statuses, the persisted rows and whether a turn is still alive.
 */

let dir: string;

function resetStoreGlobals(): void {
  delete (globalThis as { __piSubagentsDb?: unknown }).__piSubagentsDb;
  delete (globalThis as { __piSubagentProfilesSeeded?: unknown }).__piSubagentProfilesSeeded;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagent-tasks-"));
  process.env.PI_WORK_SUBAGENTS_DB = join(dir, "subagents.db");
  process.env.PI_WORK_DATA_DIR = dir;
});

afterAll(() => {
  resetStoreGlobals();
  delete process.env.PI_WORK_SUBAGENTS_DB;
  delete process.env.PI_WORK_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  resetStoreGlobals();
});

const profile: SubagentProfile = {
  name: "codebase_explorer",
  description: "Read-only exploration.",
  systemPrompt: "Explore only.",
  inheritSystemPrompt: false,
  tools: ["read", "subagent"],
  model: { provider: "p", modelId: "m-profile" },
  thinkingLevel: "low",
  bot: { expression: 0, stateKey: "idle", shapeId: "blob", parts: [], accessories: [] },
  timeoutMs: 30 * 60 * 1000,
  builtin: true,
  createdAt: 0,
  updatedAt: 0,
};

function configFor(overrides: Partial<SubagentTaskConfigSnapshot> = {}): SubagentTaskConfigSnapshot {
  return {
    ...resolveSubagentTaskConfig({
      profile,
      cwd: "/tmp/work",
      parentModel: { provider: "p", modelId: "m-parent" },
      parentSystemPrompt: null,
    }),
    ...overrides,
  };
}

/** A scripted turn: one deferred per started turn, completed by the test. */
function makeManager(
  overrides: Partial<SubagentTaskManagerDeps> & { runTurn: SubagentTaskManagerDeps["runTurn"] },
): SubagentTaskManager {
  return createSubagentTaskManager({
    timers: createFakeTimers().timers,
    createChildSession: createChildSessionFactory().factory,
    ...overrides,
  } as SubagentTaskManagerDeps);
}

describe("spawn: stable id, snapshot and independent wait", () => {
  it("assigns a stable task id and persists the config snapshot before the child exists", async () => {
    const runner = createScriptedRunner();
    const manager = makeManager({ runTurn: runner.runTurn });
    const progress = manager.spawn({ parentSessionId: "parent-1", description: "explore", prompt: "look around", config: configFor() });

    expect(progress.taskId).toMatch(/^[1-9]\d*$/);
    // A free slot admits it at once, so it is already `creating` when spawn
    // returns; the id exists and is persisted either way (queueing is covered
    // by the scheduling tests).
    expect(progress.status).toBe("creating");
    expect(progress.childSessionId).toBeNull();

    const row = getSubagentTask(progress.taskId)!;
    expect(row.status).toBe("creating");
    expect(row.parentSessionId).toBe("parent-1");
    const snapshot = JSON.parse(row.configSnapshot!) as SubagentTaskConfigSnapshot;
    expect(snapshot.subagentName).toBe("codebase_explorer");
    expect(snapshot.model).toEqual({ provider: "p", modelId: "m-profile" });
    expect(snapshot.thinkingLevel).toBe("low");
    expect(snapshot.timeoutMs).toBe(profile.timeoutMs);
    // The subagent tool is never part of a child's tool set: recursion stays
    // blocked even when the profile lists it.
    expect(snapshot.tools).toEqual(["read"]);

    // Let the scripted turn finish so the slot is released.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await runner.turns[0].settle();
    await manager.idle();
  });

  it("hands out short numeric ids that keep increasing", () => {
    const seed = {
      parentSessionId: "parent-ids",
      subagentName: "codebase_explorer",
      description: "explore",
      prompt: "look around",
    };
    const first = createSubagentTask(seed);
    const second = createSubagentTask(seed);

    // A parent only delegates a handful of subagents, so a counter reads far
    // better than a uuid in tool output and in copy-pasted task ids.
    expect(first.taskId).toMatch(/^[1-9]\d*$/);
    expect(Number(second.taskId)).toBe(Number(first.taskId) + 1);
  });

  it("defaults the wait to 15 minutes and does not cancel when it expires", async () => {
    const runner = createScriptedRunner();
    const timers = createFakeTimers();
    const child = createChildSessionFactory();
    const manager = makeManager({ runTurn: runner.runTurn, timers: timers.timers, createChildSession: child.factory });

    const task = manager.spawn({ parentSessionId: "parent-2", description: "long job", prompt: "work", config: configFor() });
    const waiting = manager.wait(task.taskId);

    // Let spawn's turn start and acquire its child session.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runner.turns).toHaveLength(1);
    await runner.turns[0].acquire();

    const deadline = timers.scheduled.find((timer) => !timer.cancelled);
    expect(deadline?.ms).toBe(DEFAULT_SUBAGENT_WAIT_MS);

    deadline!.fire();
    const observed = await waiting;
    expect(observed.waitExpired).toBe(true);
    expect(observed.status).toBe("running");
    expect(getSubagentTask(task.taskId)!.status).toBe("running");

    // The wait expiring is observation only: the turn is still alive and its
    // runtime limit was handed over in full at start.
    expect(runner.turns[0].spec.timeoutMs).toBe(profile.timeoutMs);
    expect(runner.turns[0].spec.confirmStop).toBe(true);

    await runner.turns[0].settle({ text: "finished late", realSessionId: child.created[0] });
    await manager.idle();
    const finished = getSubagentTask(task.taskId)!;
    expect(finished.status).toBe("completed");
    expect(finished.result).toBe("finished late");
  });

  it("returns at once with wait_ms = 0 and stays observable afterwards", async () => {
    const runner = createScriptedRunner();
    const child = createChildSessionFactory();
    const manager = makeManager({ runTurn: runner.runTurn, createChildSession: child.factory });

    const task = manager.spawn({ parentSessionId: "parent-3", description: "quick", prompt: "go", config: configFor() });
    const immediate = await manager.wait(task.taskId, { timeoutMs: 0 });
    expect(immediate.waitExpired).toBe(true);
    expect(immediate.childSessionId).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await runner.turns[0].acquire();
    await runner.turns[0].settle({ text: "done quickly", realSessionId: child.created[0] });

    const later = await manager.wait(task.taskId, { timeoutMs: 0 });
    expect(later.waitExpired).toBe(false);
    expect(later.status).toBe("completed");
    expect(later.result).toBe("done quickly");
    await manager.idle();
  });
});

describe("scheduling", () => {
  async function startMany(manager: SubagentTaskManager, count: number) {
    const tasks = [];
    for (let i = 0; i < count; i += 1) {
      tasks.push(manager.spawn({
        parentSessionId: "parent-sched",
        description: `task ${i}`,
        prompt: `job ${i}`,
        config: configFor(),
      }));
    }
    return tasks;
  }

  it("runs at most four tasks, queues the rest FIFO and starts them as slots free", async () => {
    const runner = createScriptedRunner();
    const child = createChildSessionFactory();
    const manager = makeManager({ runTurn: runner.runTurn, createChildSession: child.factory });

    const tasks = await startMany(manager, 5);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runner.turns).toHaveLength(4);
    expect(runner.turns.map((turn) => turn.spec.prompt)).toEqual(["job 0", "job 1", "job 2", "job 3"]);
    expect(getSubagentTask(tasks[4].taskId)!.status).toBe("queued");

    // Freeing one slot admits the queued task, still with its full runtime
    // limit — queue time never counts against it.
    await runner.turns[0].settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runner.turns).toHaveLength(5);
    expect(runner.turns[4].spec.prompt).toBe("job 4");
    expect(runner.turns[4].spec.timeoutMs).toBe(profile.timeoutMs);

    for (const turn of runner.turns.slice(1)) await turn.settle();
    await manager.idle();
  });

  it("cancels a queued task without ever starting a turn", async () => {
    const runner = createScriptedRunner();
    const manager = makeManager({ runTurn: runner.runTurn });
    const tasks = await startMany(manager, 5);
    await new Promise((resolve) => setTimeout(resolve, 0));

    manager.stop(tasks[4].taskId, "queued cancel");
    expect(getSubagentTask(tasks[4].taskId)!.status).toBe("cancelled");

    await runner.turns[0].settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runner.turns).toHaveLength(4);
    expect(getSubagentTask(tasks[4].taskId)!.status).toBe("cancelled");

    for (const turn of runner.turns.slice(1)) await turn.settle();
    await manager.idle();
  });
});

describe("stops and persistence", () => {
  it("does not overwrite a completed task when a late stop arrives", async () => {
    const runner = createScriptedRunner();
    const manager = makeManager({ runTurn: runner.runTurn });
    const task = manager.spawn({ parentSessionId: "parent-late", description: "d", prompt: "p", config: configFor() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await runner.turns[0].settle({ text: "result" });
    await manager.idle();

    manager.stop(task.taskId, "late cancel");
    const row = getSubagentTask(task.taskId)!;
    expect(row.status).toBe("completed");
    expect(row.result).toBe("result");
  });

  it("reports a requested stop as stopping until the turn confirms it", async () => {
    const runner = createScriptedRunner();
    const child = createChildSessionFactory();
    const manager = makeManager({ runTurn: runner.runTurn, createChildSession: child.factory });
    const task = manager.spawn({ parentSessionId: "parent-stop", description: "d", prompt: "p", config: configFor() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await runner.turns[0].acquire();
    expect(getSubagentTask(task.taskId)!.status).toBe("running");

    manager.stop(task.taskId, "user stop");
    expect(getSubagentTask(task.taskId)!.status).toBe("stopping");

    // The turn confirms the stop by settling as cancelled.
    await runner.turns[0].settle({ status: "cancelled", text: "", hasReply: false, error: "user stop", realSessionId: child.created[0] });
    await manager.idle();
    expect(getSubagentTask(task.taskId)!.status).toBe("cancelled");
  });

  it("stops a task when the waiting tool call is aborted", async () => {
    const runner = createScriptedRunner();
    const child = createChildSessionFactory();
    const manager = makeManager({ runTurn: runner.runTurn, createChildSession: child.factory });
    const task = manager.spawn({ parentSessionId: "parent-abort", description: "d", prompt: "p", config: configFor() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await runner.turns[0].acquire();

    const controller = new AbortController();
    const waiting = manager.wait(task.taskId, {
      timeoutMs: DEFAULT_SUBAGENT_WAIT_MS,
      stopOnAbort: { signal: controller.signal, reason: "Subagent cancelled" },
    });
    controller.abort();
    const observed = await waiting;
    expect(observed.status).toBe("stopping");

    await runner.turns[0].settle({ status: "cancelled", text: "", hasReply: false, error: "Subagent cancelled", realSessionId: child.created[0] });
    await manager.idle();
    expect(getSubagentTask(task.taskId)!.status).toBe("cancelled");
  });

  it("marks stale rows interrupted when the manager starts after a restart", () => {
    const stale = createSubagentTask({
      taskId: "subagent:stale",
      parentSessionId: "parent-restart",
      subagentName: "codebase_explorer",
      description: "was running",
      prompt: "p",
    });
    markSubagentRunning(stale.taskId, "child-stale");

    const runner = createScriptedRunner();
    makeManager({ runTurn: runner.runTurn, reconcileOnCreate: true });

    const row = getSubagentTask(stale.taskId) as SubagentTask;
    expect(row.status).toBe("interrupted");
    expect(row.error).toContain("restarted");
    // No replay: the manager starts nothing for it.
    expect(runner.turns).toHaveLength(0);
  });
});
