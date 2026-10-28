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
  type SubagentTaskManager,
} from "@/lib/server/subagent-tasks";
import {
  getSubagentTask,
  listSubagentTasksForChildSession,
  type SubagentTask,
} from "@/lib/server/subagent-store";
import {
  submitSubagentManualPrompt,
  SubagentManualInputError,
} from "@/lib/server/subagent-manual-input";
import {
  createChildSessionFactory,
  createScriptedRunner,
  type ScriptedTurn,
} from "./support/subagent-runtime";
import { SUBAGENT_RESULT_WINDOW_DEFAULT } from "@/lib/shared/subagent";

/**
 * Issue 08: end-to-end acceptance across the whole lifecycle.
 *
 * One continuous story per test, driven through the same external entries the
 * product uses — the `subagent` tool, the manual-input module, the REST
 * stop-all endpoint — over a real task manager and a temporary SQLite store,
 * with the turn seam scripted. The manager's own live-status query is used only
 * to prove that no turn is still running. Earlier tickets own the per-behaviour
 * assertions; this file only checks that the flows compose: a timed-out wait
 * becomes a background task you can find, wait on, continue, cancel precisely
 * and stop as a parent, and that manual and agent entries obey one shared set
 * of rules.
 */

let dir: string;
let seq = 0;

function unique(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function resetGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.__piSubagentsDb;
  delete g.__piSubagentProfilesSeeded;
  delete g.__piSubagentTaskManager;
  delete g.__piSessionListCache;
  delete g.__piSessionPathCache;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagent-acceptance-"));
  process.env.PI_WORK_SUBAGENTS_DB = join(dir, "subagents.db");
  process.env.PI_WORK_DATA_DIR = join(dir, "data");
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

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

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

function setup() {
  const runner = createScriptedRunner();
  const child = createChildSessionFactory();
  const manager: SubagentTaskManager = createSubagentTaskManager({
    runTurn: runner.runTurn,
    createChildSession: child.factory,
  });
  setSubagentTaskManagerForTests(manager);
  setSubagentParentResolverForTests(async (id) => parentContext(id));
  return { runner, child, manager };
}

async function spawnTask(parentSessionId: string, description = "long job"): Promise<string> {
  const spawned = await run(
    {
      action: "spawn",
      subagent_name: "codebase_explorer",
      description,
      prompt: "work",
      wait_ms: 0,
    },
    parentSessionId,
  );
  expect(spawned.isError).toBeUndefined();
  return (spawned.details as { taskId: string }).taskId;
}

async function settle(turn: ScriptedTurn | undefined, realSessionId: string, text = "done") {
  await turn?.settle({ text, realSessionId });
}

function row(taskId: string): SubagentTask {
  const task = getSubagentTask(taskId);
  if (!task) throw new Error(`missing task row ${taskId}`);
  return task;
}

function detailOf<T>(result: Awaited<ReturnType<typeof run>>): T {
  return result.details as T;
}

// ============================================================================
// One delegated task, from a timed-out wait to a precise stop
// ============================================================================

describe("acceptance: one continuous delegation", () => {
  it("follows a task from wait expiry through discovery, result, continue and a precise cancel", async () => {
    const parent = unique("parent-flow");
    const { runner, manager } = setup();

    // 1. Spawn with no wait: the task id is stable before the child exists and
    // the task keeps running.
    const firstTask = await spawnTask(parent, "map the module");
    await runner.turns[0].acquire();
    const child = row(firstTask).childSessionId!;
    expect(child).toBeTruthy();

    // 2. An expired wait only ends the observation.
    const observed = await run({ action: "wait", task_id: firstTask, wait_ms: 0 }, parent);
    expect(observed.isError).toBeUndefined();
    expect(textOf(observed)).toContain("still running");
    expect(textOf(observed)).toContain("not cancelled");
    expect(manager.liveStatus(firstTask)).toBe("running");

    // 3. The background task is findable again through list/get.
    const listed = await run({ action: "list", status: "running", limit: 10 }, parent);
    const entries = detailOf<{ entries: Array<{ sessionId: string; taskCount: number; latestTask: { taskId: string } }> }>(listed).entries;
    expect(entries).toEqual([
      expect.objectContaining({
        sessionId: child,
        taskCount: 1,
        latestTask: expect.objectContaining({ taskId: firstTask }),
      }),
    ]);
    const got = await run({ action: "get", task_id: firstTask }, parent);
    expect(detailOf<{ detail: { task: { status: string } } }>(got).detail.task.status).toBe("running");

    // 4. It finishes later; a second wait returns the landed result at once.
    await settle(runner.turns[0], child, "first answer");
    await manager.idle();
    const final = await run({ action: "wait", task_id: firstTask, wait_ms: 0 }, parent);
    expect(final.isError).toBeUndefined();
    expect(textOf(final)).toContain("Subagent completed");
    expect(textOf(final)).toContain("first answer");
    expect(detailOf<{ waitExpired: boolean; status: string; result: string }>(final))
      .toMatchObject({ waitExpired: false, status: "completed", result: "first answer" });

    // 5. Continue the same child session: new task id, old task untouched.
    const continued = await run(
      { action: "continue", session_id: child, prompt: "keep going", wait_ms: 0 },
      parent,
    );
    expect(continued.isError).toBeUndefined();
    const secondTask = detailOf<{ taskId: string }>(continued).taskId;
    expect(secondTask).not.toBe(firstTask);
    expect(runner.turns).toHaveLength(2);
    expect(runner.turns[1].spec.session).toEqual({ kind: "reuse", sessionId: child });
    await runner.turns[1].acquire();
    expect(row(firstTask)).toMatchObject({ status: "completed", result: "first answer" });

    // 6. A late cancel of the finished task is honest and touches nothing.
    const late = await run({ action: "cancel", task_id: firstTask }, parent);
    expect(late.isError).toBeUndefined();
    expect(detailOf<{ requested: boolean; status: string }>(late))
      .toMatchObject({ requested: false, status: "completed" });
    expect(manager.liveStatus(secondTask)).toBe("running");

    // 7. The child's history keeps both tasks, newest first, in one list row.
    await settle(runner.turns[1], child, "second answer");
    await manager.idle();
    const after = await run({ action: "list", limit: 10 }, parent);
    const afterEntries = detailOf<{ entries: Array<{ sessionId: string; taskCount: number; latestTask: { taskId: string; status: string } }> }>(after).entries;
    expect(afterEntries).toHaveLength(1);
    expect(afterEntries[0]).toMatchObject({
      sessionId: child,
      taskCount: 2,
      latestTask: { taskId: secondTask, status: "completed" },
    });

    // 8. The parent's total stop cascades over a fresh background task through
    // the same endpoint the UI uses.
    const thirdTask = await spawnTask(parent, "another job");
    await runner.turns[2].acquire();
    const { POST } = await import("@/app/api/sessions/[id]/subagents/stop-all/route");
    const response = await POST(
      new Request(`http://localhost/api/sessions/${parent}/subagents/stop-all`, { method: "POST" }),
      { params: Promise.resolve({ id: parent }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, stopped: 1, stopping: true });
    // Stopping is not stopped: the row waits for the turn to confirm.
    expect(row(thirdTask).status).toBe("stopping");
    expect(manager.liveStatus(thirdTask)).toBe("stopping");

    await runner.turns[2].settle({
      status: "cancelled",
      text: "",
      hasReply: false,
      error: "stopped with the parent",
      realSessionId: row(thirdTask).childSessionId ?? child,
    });
    await manager.idle();
    expect(row(thirdTask).status).toBe("cancelled");
    expect(manager.isStopping(parent)).toBe(false);
    // The completed tasks were never rewritten by the cascade.
    expect(row(firstTask).status).toBe("completed");
    expect(row(secondTask).status).toBe("completed");
  });
});

// ============================================================================
// Manual input and agent delegation share one rule set
// ============================================================================

describe("acceptance: manual and agent entries", () => {
  it("keeps one unfinished task per child and refuses new work during the parent's stop", async () => {
    const parent = unique("parent-cross");
    const { runner, manager } = setup();
    const firstTask = await spawnTask(parent, "delegated job");
    await runner.turns[0].acquire();
    const child = row(firstTask).childSessionId!;

    // The user cannot type a second, overlapping turn into the busy child.
    expect(submitErrorCode(() => submitSubagentManualPrompt({ childSessionId: child, message: "me too" })))
      .toBe("busy");

    // The parent's total stop enters a window that refuses both entries.
    expect(manager.stopAll(parent)).toMatchObject({ stopped: 1, stopping: true });
    expect(submitErrorCode(() => submitSubagentManualPrompt({ childSessionId: child, message: "me too" })))
      .toBe("stopping");
    const refusedContinue = await run(
      { action: "continue", session_id: child, prompt: "again", wait_ms: 0 },
      parent,
    );
    expect(refusedContinue.isError).toBe(true);
    expect(textOf(refusedContinue)).toContain("stopping all subagent tasks");
    const refusedSpawn = await run(
      { action: "spawn", subagent_name: "codebase_explorer", description: "later", prompt: "later", wait_ms: 0 },
      parent,
    );
    expect(refusedSpawn.isError).toBe(true);
    // No turn was started for either refusal.
    expect(runner.turns).toHaveLength(1);

    // The stop is confirmed by the turn, then the window closes.
    await runner.turns[0].settle({
      status: "cancelled",
      text: "",
      hasReply: false,
      error: "stopped with the parent",
      realSessionId: child,
    });
    await manager.idle();
    expect(row(firstTask).status).toBe("cancelled");
    expect(manager.isStopping(parent)).toBe(false);

    // An explicit manual follow-up is now admitted as its own tracked task.
    const manual = submitSubagentManualPrompt({ childSessionId: child, message: "my own follow-up" });
    expect(manual.origin).toBe("manual");
    expect(manual.taskId).not.toBe(firstTask);
    await runner.turns[1].acquire();
    expect(manager.liveStatus(manual.taskId)).toBe("running");

    // ...and the agent's continue obeys the same busy rule in the reverse
    // direction: a manual turn is not something continue may overlap.
    const refusedBusy = await run(
      { action: "continue", session_id: child, prompt: "overlap", wait_ms: 0 },
      parent,
    );
    expect(refusedBusy.isError).toBe(true);
    expect(textOf(refusedBusy)).toContain("busy");
    expect(runner.turns).toHaveLength(2);

    // A late cancel of the earlier task does not touch the manual one.
    const late = await run({ action: "cancel", task_id: firstTask }, parent);
    expect(detailOf<{ requested: boolean; status: string }>(late))
      .toMatchObject({ requested: false, status: "cancelled" });
    expect(manager.liveStatus(manual.taskId)).toBe("running");

    await settle(runner.turns[1], child, "manual answer");
    await manager.idle();
    // Both tasks stay readable and tell manual from delegated apart.
    const history = listSubagentTasksForChildSession(parent, child);
    expect(history.map((task) => [task.taskId, task.status, task.origin])).toEqual([
      [manual.taskId, "completed", "manual"],
      [firstTask, "cancelled", "tool"],
    ]);
    const got = await run({ action: "get", session_id: child }, parent);
    expect(got.isError).toBeUndefined();
    const items = detailOf<{ tasks: { items: Array<{ taskId: string; origin: string }> } }>(got).tasks.items;
    expect(items.map((task) => [task.taskId, task.origin])).toEqual([
      [manual.taskId, "manual"],
      [firstTask, "tool"],
    ]);
  });
});

// ============================================================================
// Bounded results and the retired entry point
// ============================================================================

describe("acceptance: result boundaries and the old name", () => {
  it("returns a long result as a marked window that get can finish", async () => {
    const parent = unique("parent-long");
    const { runner, manager } = setup();
    const taskId = await spawnTask(parent, "write a report");
    await runner.turns[0].acquire();
    const child = row(taskId).childSessionId!;
    const long = `${"x".repeat(SUBAGENT_RESULT_WINDOW_DEFAULT)}TAIL-MARKER`;
    await settle(runner.turns[0], child, long);
    await manager.idle();

    const waited = await run({ action: "wait", task_id: taskId, wait_ms: 0 }, parent);
    const text = textOf(waited);
    expect(text).toContain("Subagent completed");
    expect(text).toContain("[truncated]");
    expect(text).toContain(`result_offset=${SUBAGENT_RESULT_WINDOW_DEFAULT}`);
    // The returned details are bounded too, and say so instead of silently
    // handing back a prefix.
    expect(detailOf<{ result: string; resultTruncated: boolean; resultNextOffset: number }>(waited))
      .toMatchObject({
        result: "x".repeat(SUBAGENT_RESULT_WINDOW_DEFAULT),
        resultTruncated: true,
        resultNextOffset: SUBAGENT_RESULT_WINDOW_DEFAULT,
      });

    const rest = await run(
      { action: "get", task_id: taskId, result_offset: SUBAGENT_RESULT_WINDOW_DEFAULT },
      parent,
    );
    const window = detailOf<{
      detail: { result: { offset: number; text: string; truncated: boolean; total: number } };
    }>(rest).detail.result;
    expect(window).toMatchObject({
      offset: SUBAGENT_RESULT_WINDOW_DEFAULT,
      text: "TAIL-MARKER",
      truncated: true,
      total: long.length,
    });
  });

  it("refuses the retired spawn_subagent action without creating a task", async () => {
    const parent = unique("parent-legacy");
    const { runner } = setup();
    const legacy = await subagentTool.execute!(
      "call-legacy",
      {
        action: "spawn_subagent",
        subagent_name: "codebase_explorer",
        description: "old call",
        prompt: "old",
      } as unknown as ExecuteParams,
      undefined,
      undefined,
      fakeContext(parent),
    );
    expect(legacy.isError).toBe(true);
    expect(runner.turns).toHaveLength(0);
  });
});

function submitErrorCode(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof SubagentManualInputError ? error.code : null;
  }
}
