import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  type ScriptedTurn,
} from "./support/subagent-runtime";
import {
  createSubagentTaskManager,
  setSubagentTaskManagerForTests,
  stopAllSubagentTasksForParent,
  SUBAGENT_PARENT_DELETED,
  SUBAGENT_PARENT_STOPPED,
  type SubagentTaskManager,
} from "@/lib/server/subagent-tasks";
import {
  getSubagentTask,
  type SubagentTask,
} from "@/lib/server/subagent-store";
import { AgentSessionWrapper } from "@/lib/server/rpc-manager";
import { deleteSession } from "@/lib/server/sessions/mutations";
import { cacheSessionPath } from "@/lib/server/sessions/reader";
import type { AgentSessionLike } from "@/lib/server/pi-types";

/**
 * `subagent` action `cancel` plus the two session-level stops: the parent
 * session's own stop command and parent-session deletion.
 *
 * Driven through the tool's external interface (and, for the session-level
 * entries, through `AgentSessionWrapper.send({type:"abort"})` and
 * `deleteSession`) with a scripted turn adapter, a fake child session and a
 * temp data root. The assertions are only about what the parent reads and
 * whether a turn is still alive: a stop request is never reported as a
 * confirmed stop until the turn says so.
 */

let dir: string;

function resetGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.__piSubagentsDb;
  delete g.__piSubagentProfilesSeeded;
  delete g.__piSubagentTaskManager;
  delete g.__piSessionListCache;
  delete g.__piSessionPathCache;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagent-cancel-"));
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
// Scripted turn + child session + timer seams (shared with the task/wait
// lifecycle suites so all three drive the same runtime shape)
// ---------------------------------------------------------------------------

function setup(parentSessionId: string) {
  const runner = createScriptedRunner();
  const timers = createFakeTimers();
  const child = createChildSessionFactory();
  const manager: SubagentTaskManager = createSubagentTaskManager({
    runTurn: runner.runTurn,
    createChildSession: child.factory,
    timers: timers.timers,
  });
  setSubagentTaskManagerForTests(manager);
  setSubagentParentResolverForTests(async (id) => parentContext(id));
  return { runner, timers, child, manager, parentSessionId };
}

/** Create a task through `spawn` with `wait_ms: 0`; returns its stable id. */
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
  const details = spawned.details as { action: string; taskId: string };
  expect(details.action).toBe("spawn");
  return details.taskId;
}

/** Settle a turn as a user stop, the way the real turn module confirms it. */
async function settleCancelled(turn: ScriptedTurn | undefined, realSessionId: string | undefined, reason: string) {
  await turn?.settle({
    status: "cancelled",
    text: "",
    hasReply: false,
    error: reason,
    realSessionId: realSessionId ?? "child-unknown",
  });
}

function row(parentSessionId: string, taskId: string): SubagentTask {
  const task = getSubagentTask(parentSessionId, taskId);
  if (!task) throw new Error(`missing task row ${taskId}`);
  return task;
}

// ============================================================================

describe("subagent tool — cancel action", () => {
  it("reports a running task as stopping and cancelled only after the turn confirms", async () => {
    const { runner, child, manager } = setup("parent-cancel");
    const taskId = await spawnTask("parent-cancel");
    await runner.turns[0].acquire();

    const cancelled = await run({ action: "cancel", task_id: taskId }, "parent-cancel");
    expect(cancelled.isError).toBeUndefined();
    expect(cancelled.details).toMatchObject({
      action: "cancel",
      taskId,
      status: "stopping",
      requested: true,
    });
    expect(textOf(cancelled)).toContain("is stopping");
    expect(textOf(cancelled)).toContain("confirm");
    expect(textOf(cancelled)).toContain(`action="wait", task_id="${taskId}"`);
    // The request did not release the slot: the stop is not confirmed yet.
    expect(manager.liveStatus("parent-cancel", taskId)).toBe("stopping");
    expect(row("parent-cancel", taskId).status).toBe("stopping");
    expect(row("parent-cancel", taskId).finishedAt).toBeNull();

    await settleCancelled(runner.turns[0], child.created[0], "Subagent cancelled");
    await manager.idle();
    expect(row("parent-cancel", taskId).status).toBe("cancelled");
    expect(manager.liveStatus("parent-cancel", taskId)).toBeNull();

    // A repeated cancel is safe and does not rewrite the terminal row.
    const again = await run({ action: "cancel", task_id: taskId }, "parent-cancel");
    expect(again.details).toMatchObject({ status: "cancelled", requested: false });
    expect(textOf(again)).toContain("already cancelled");
  });

  it("cancels a queued task without ever starting its turn", async () => {
    const { runner, timers, manager } = setup("parent-queue-cancel");
    // Four slots + one queued task.
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await spawnTask("parent-queue-cancel", `job ${i}`));
    expect(runner.turns).toHaveLength(4);
    expect(row("parent-queue-cancel", ids[4]).status).toBe("queued");

    const cancelled = await run({ action: "cancel", task_id: ids[4] }, "parent-queue-cancel");
    expect(cancelled.details).toMatchObject({ status: "cancelled", requested: true });
    expect(textOf(cancelled)).toContain("before it started");

    // Freeing a slot must not admit the cancelled task.
    await runner.turns[0].settle({ text: "first done" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runner.turns).toHaveLength(4);
    expect(row("parent-queue-cancel", ids[4]).status).toBe("cancelled");
    // Cancel never created a wait deadline of its own.
    expect(timers.scheduled).toHaveLength(0);

    for (const turn of runner.turns.slice(1)) await turn.settle();
    await manager.idle();
  });

  it("keeps the slot of a stopping task until the turn confirms, then admits the queue", async () => {
    const { runner, manager } = setup("parent-slot-hold");
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) ids.push(await spawnTask("parent-slot-hold", `job ${i}`));
    expect(runner.turns).toHaveLength(4);

    await run({ action: "cancel", task_id: ids[0] }, "parent-slot-hold");
    expect(row("parent-slot-hold", ids[0]).status).toBe("stopping");

    // A requested stop is not a released slot: the fifth task still queues.
    const queuedId = await spawnTask("parent-slot-hold", "next job");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(row("parent-slot-hold", queuedId).status).toBe("queued");
    expect(runner.turns).toHaveLength(4);

    // Only the confirmed stop frees the slot and admits the queued task.
    await settleCancelled(runner.turns[0], undefined, "Subagent cancelled");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(row("parent-slot-hold", ids[0]).status).toBe("cancelled");
    expect(runner.turns).toHaveLength(5);
    expect(runner.turns[4].spec.prompt).toBe("work");
    expect(row("parent-slot-hold", queuedId).status).not.toBe("queued");

    for (const turn of runner.turns.slice(1)) await turn.settle({ text: "done" });
    await manager.idle();
  });

  it("leaves a completed task and its result untouched by a late cancel", async () => {
    const { runner, manager } = setup("parent-late-cancel");
    const taskId = await spawnTask("parent-late-cancel");
    await runner.turns[0].settle({ text: "landed answer" });
    await manager.idle();
    expect(row("parent-late-cancel", taskId).status).toBe("completed");

    const late = await run({ action: "cancel", task_id: taskId }, "parent-late-cancel");
    expect(late.details).toMatchObject({
      status: "completed",
      requested: false,
      result: "landed answer",
    });
    expect(textOf(late)).toContain("already completed");
    expect(textOf(late)).not.toContain("was cancelled");
    expect(row("parent-late-cancel", taskId).result).toBe("landed answer");
  });

  it("keeps a result that lands while the cancelled turn is being confirmed", async () => {
    const { runner, manager } = setup("parent-cancel-race");
    const taskId = await spawnTask("parent-cancel-race");
    await runner.turns[0].acquire();

    await run({ action: "cancel", task_id: taskId }, "parent-cancel-race");
    expect(row("parent-cancel-race", taskId).status).toBe("stopping");

    // The child finished with a real reply before the stop was confirmed: the
    // landed result wins, and the row must not be downgraded to cancelled.
    await runner.turns[0].settle({ text: "finished anyway" });
    await manager.idle();
    expect(row("parent-cancel-race", taskId).status).toBe("completed");
    expect(row("parent-cancel-race", taskId).result).toBe("finished anyway");
  });

  it("only cancels its own parent's task and validates its arguments", async () => {
    const { runner, manager } = setup("parent-owner");
    const taskId = await spawnTask("parent-owner");
    await runner.turns[0].acquire();

    const denied = await run({ action: "cancel", task_id: taskId }, "parent-intruder");
    expect(denied.isError).toBe(true);
    expect(textOf(denied)).toContain("No subagent task");
    expect(manager.liveStatus("parent-owner", taskId)).toBe("running");

    const missing = await run({ action: "cancel" } as ExecuteParams, "parent-owner");
    expect(missing.isError).toBe(true);
    expect(missing.details).toMatchObject({ action: "cancel" });
    expect(textOf(missing)).toContain("requires task_id");

    const foreign = await run(
      { action: "cancel", task_id: taskId, session_id: "child-1" } as ExecuteParams,
      "parent-owner",
    );
    expect(foreign.isError).toBe(true);
    expect(textOf(foreign)).toContain("does not accept session_id");

    // None of the rejected calls stopped the task.
    expect(manager.liveStatus("parent-owner", taskId)).toBe("running");
    await settleCancelled(runner.turns[0], undefined, "Subagent cancelled");
    await manager.idle();
  });
});

describe("parent session stop", () => {
  it("cancels every unfinished child task (running and queued) and closes the spawn window", async () => {
    const { runner, child, manager } = setup("parent-stop-all");
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await spawnTask("parent-stop-all", `job ${i}`));
    expect(runner.turns).toHaveLength(4);

    const stopped = manager.stopAll("parent-stop-all", SUBAGENT_PARENT_STOPPED);
    expect(stopped.stopped).toBe(5);
    expect(stopped.stopping).toBe(true);
    expect(manager.isStopping("parent-stop-all")).toBe(true);
    // Queued task is cancelled at once; running ones are held in `stopping`
    // and still own their slots.
    for (const taskId of ids.slice(0, 4)) expect(row("parent-stop-all", taskId).status).toBe("stopping");
    expect(row("parent-stop-all", ids[4]).status).toBe("cancelled");

    // A new spawn during the stop is refused, not queued behind it.
    const refused = await run(
      {
        action: "spawn",
        subagent_name: "codebase_explorer",
        description: "sneaky",
        prompt: "work",
        wait_ms: 0,
      },
      "parent-stop-all",
    );
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("stopping all subagent tasks");
    expect(runner.turns).toHaveLength(4);

    // Confirm the four running stops.
    for (let i = 0; i < 4; i += 1) {
      await settleCancelled(runner.turns[i], child.created[i], SUBAGENT_PARENT_STOPPED);
    }
    await manager.idle();
    for (const taskId of ids) expect(row("parent-stop-all", taskId).status).toBe("cancelled");
    expect(manager.isStopping("parent-stop-all")).toBe(false);

    // The window is over: explicit delegation works again.
    const allowed = await run(
      {
        action: "spawn",
        subagent_name: "codebase_explorer",
        description: "after the stop",
        prompt: "work",
        wait_ms: 0,
      },
      "parent-stop-all",
    );
    expect(allowed.isError).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runner.turns).toHaveLength(5);
    await runner.turns[4].settle({ text: "done after" });
    await manager.idle();
  });

  it("does not touch another session's tasks and does not stop on an ordinary turn end", async () => {
    const { runner, manager } = setup("parent-scope");
    const mine = await spawnTask("parent-scope");
    const other = await spawnTask("parent-other");
    await runner.turns[0].acquire();
    await runner.turns[1].acquire();

    // An ordinary end of the parent's own turn is not a stop: the child keeps
    // running and stays managed.
    expect(manager.liveStatus("parent-scope", mine)).toBe("running");

    stopAllSubagentTasksForParent("parent-scope", SUBAGENT_PARENT_STOPPED);
    expect(row("parent-scope", mine).status).toBe("stopping");
    expect(row("parent-other", other).status).toBe("running");
    expect(manager.liveStatus("parent-other", other)).toBe("running");

    await settleCancelled(runner.turns[0], undefined, SUBAGENT_PARENT_STOPPED);
    await runner.turns[1].settle({ text: "other answer" });
    await manager.idle();
    expect(row("parent-scope", mine).status).toBe("cancelled");
    expect(row("parent-other", other).status).toBe("completed");
  });

  it("reaches the task manager from the parent session's abort command", async () => {
    const { runner, manager } = setup("parent-abort-contract");
    const taskId = await spawnTask("parent-abort-contract");
    await runner.turns[0].acquire();

    let aborted = false;
    const inner = {
      sessionId: "parent-abort-contract",
      sessionFile: undefined,
      isStreaming: false,
      isCompacting: false,
      systemPrompt: "",
      model: undefined,
      agent: { state: { messages: [] } },
      sessionManager: { getSessionName: () => null },
      getContextUsage: () => undefined,
      abort: async () => {
        aborted = true;
      },
    } as unknown as AgentSessionLike;
    const wrapper = new AgentSessionWrapper(inner, "user", null);

    await wrapper.send({ type: "abort" });
    expect(aborted).toBe(true);
    expect(manager.liveStatus("parent-abort-contract", taskId)).toBe("stopping");
    expect(row("parent-abort-contract", taskId).status).toBe("stopping");

    await settleCancelled(runner.turns[0], undefined, SUBAGENT_PARENT_STOPPED);
    await manager.idle();
    expect(row("parent-abort-contract", taskId).status).toBe("cancelled");
    wrapper.destroy();
  });

  it("offers an independent stop-all endpoint for a parent turn that already ended", async () => {
    const { runner, manager } = setup("parent-api-stop");
    const taskId = await spawnTask("parent-api-stop");
    await runner.turns[0].acquire();

    const { POST } = await import("@/app/api/sessions/[id]/subagents/stop-all/route");
    const response = await POST(
      new Request("http://localhost/api/sessions/parent-api-stop/subagents/stop-all", { method: "POST" }),
      { params: Promise.resolve({ id: "parent-api-stop" }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, stopped: 1, stopping: true });
    expect(manager.liveStatus("parent-api-stop", taskId)).toBe("stopping");

    await settleCancelled(runner.turns[0], undefined, SUBAGENT_PARENT_STOPPED);
    await manager.idle();
    expect(row("parent-api-stop", taskId).status).toBe("cancelled");
  });
});

describe("parent session deletion", () => {
  it("cancels the deleted session's unfinished tasks but leaves other sessions alone", async () => {
    const { runner, manager } = setup("parent-delete");
    const mine = await spawnTask("parent-delete");
    const other = await spawnTask("parent-kept");
    await runner.turns[0].acquire();
    await runner.turns[1].acquire();

    // A real session file, cached so deletion resolves it without a full scan.
    const filePath = join(dir, "parent-delete.jsonl");
    writeFileSync(filePath, `${JSON.stringify({ type: "session", id: "parent-delete", cwd: "/tmp/work" })}\n`, "utf8");
    cacheSessionPath("parent-delete", filePath);

    const result = await deleteSession("parent-delete");
    expect(result).not.toBeNull();
    expect(row("parent-delete", mine).status).toBe("stopping");
    expect(row("parent-kept", other).status).toBe("running");

    await settleCancelled(runner.turns[0], undefined, SUBAGENT_PARENT_DELETED);
    await runner.turns[1].settle({ text: "other answer" });
    await manager.idle();
    expect(row("parent-delete", mine).status).toBe("cancelled");
    // The other parent's task finished normally; deletion never reached it.
    expect(row("parent-kept", other).status).toBe("completed");
  });
});
