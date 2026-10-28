import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createChildSessionFactory,
  createFakeTimers,
  createScriptedRunner,
  type ScriptedTurn,
} from "./support/subagent-runtime";
import {
  createSubagentTaskManager,
  openSubagentChildSession,
  setSubagentTaskManagerForTests,
  SUBAGENT_SESSION_BUSY,
  type SubagentTaskManager,
} from "@/lib/server/subagent-tasks";
import { getRegistry } from "@/lib/server/session-registry";
import {
  completeSubagentTask,
  createSubagentTask,
  getSubagentTask,
  listSubagentTasksForChildSession,
  type SubagentTask,
} from "@/lib/server/subagent-store";
import {
  isSubagentChildSession,
  manualTaskDescription,
  stopSubagentTaskForChildSession,
  SubagentManualInputError,
  submitSubagentManualPrompt,
} from "@/lib/server/subagent-manual-input";
import { setSubagentParentResolverForTests, subagentTool } from "@/lib/server/subagent-tool";
import { buildAskUserQuestionsTool } from "@/lib/server/ask-user-questions-tool";
import type { SubagentTaskConfigSnapshot } from "@/lib/shared/subagent";

/**
 * Issue 06: a user typing into a known subagent child session is the same kind
 * of work as the parent agent delegating to it, so it enters the same task
 * manager — one unfinished task per child, the global queue, request dedupe and
 * the parent's stop-all. The only seams are the entry points the product uses:
 * the manual-submit module, the real `/api/agent/[id]` request handler and the
 * `ask_user_questions` tool gate. Nothing here asserts private containers.
 */

let dir: string;

function resetGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.__piSubagentsDb;
  delete g.__piSubagentProfilesSeeded;
  delete g.__piSubagentTaskManager;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagent-manual-"));
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

const snapshot: SubagentTaskConfigSnapshot = {
  subagentName: "codebase_explorer",
  cwd: "/tmp/work",
  model: { provider: "p", modelId: "m-snapshot" },
  thinkingLevel: "high",
  tools: ["read"],
  systemPrompt: { kind: "prefix", text: "Explore only." },
  timeoutMs: 12_345,
};

let seq = 0;
function uniqueId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

/** Persist one finished task: the child session's creation, config frozen. */
function seedChildSession(input: {
  parent: string;
  child?: string;
  snapshotJson?: string | null;
}): { parent: string; child: string } {
  const child = input.child ?? uniqueId("child");
  createSubagentTask({
    taskId: `subagent:seed-${child}`,
    parentSessionId: input.parent,
    childSessionId: child,
    subagentName: snapshot.subagentName,
    description: "seeded task",
    prompt: "first input",
    configSnapshot:
      input.snapshotJson === undefined ? JSON.stringify(snapshot) : input.snapshotJson,
  });
  completeSubagentTask(input.parent, `subagent:seed-${child}`, "seeded result");
  return { parent: input.parent, child };
}

function setup() {
  const runner = createScriptedRunner();
  const timers = createFakeTimers();
  const child = createChildSessionFactory();
  const manager: SubagentTaskManager = createSubagentTaskManager({
    runTurn: runner.runTurn,
    createChildSession: child.factory,
    timers: timers.timers,
  });
  setSubagentTaskManagerForTests(manager);
  setSubagentParentResolverForTests(async (parentSessionId) => ({
    parentSessionId,
    model: { provider: "p", modelId: "m-parent" },
    systemPrompt: "parent prompt",
  }));
  return { runner, timers, child, manager };
}

function registry(): Map<string, never> {
  return getRegistry() as unknown as Map<string, never>;
}

function row(parentSessionId: string, taskId: string): SubagentTask {
  const task = getSubagentTask(parentSessionId, taskId);
  if (!task) throw new Error(`missing task row ${taskId}`);
  return task;
}

function unfinished(parentSessionId: string, childSessionId: string): SubagentTask[] {
  return listSubagentTasksForChildSession(parentSessionId, childSessionId).filter(
    (task) => task.status !== "completed"
      && task.status !== "failed"
      && task.status !== "cancelled"
      && task.status !== "interrupted",
  );
}

/** Drive one scripted turn to a cancelled end, the way the turn seam confirms. */
async function settle(
  turn: ScriptedTurn | undefined,
  childSessionId: string,
  result: Parameters<ScriptedTurn["settle"]>[0] = {},
): Promise<void> {
  await turn?.settle({ realSessionId: childSessionId, ...result });
}

// ============================================================================
// The task-manager entry
// ============================================================================

describe("manual follow-up enters task management", () => {
  it("tracks a user's input as its own manual task in the same child session", async () => {
    const { runner, manager } = setup();
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });

    const submitted = submitSubagentManualPrompt({
      childSessionId: child,
      message: "Please also check the tests\nand report what you changed.",
    });

    expect(submitted.parentSessionId).toBe(parent);
    expect(submitted.childSessionId).toBe(child);
    expect(submitted.origin).toBe("manual");
    expect(submitted.deduped).toBe(false);

    const created = row(parent, submitted.taskId);
    expect(created.origin).toBe("manual");
    expect(created.prompt).toBe("Please also check the tests\nand report what you changed.");
    expect(created.description).toBe(manualTaskDescription(created.prompt));
    expect(created.createdAt).toBeGreaterThan(0);

    await runner.turns[0].acquire();
    expect(row(parent, submitted.taskId).status).toBe("running");
    expect(manager.liveStatus(parent, submitted.taskId)).toBe("running");

    // The child stays a subagent: same session, configuration frozen at
    // creation instead of today's profile or the parent's settings.
    expect(runner.turns[0].spec.session).toEqual({ kind: "reuse", sessionId: child });
    expect(runner.turns[0].spec.source).toBe("subagent");
    expect(runner.turns[0].spec.model).toEqual(snapshot.model);
    expect(runner.turns[0].spec.thinkingLevel).toBe(snapshot.thinkingLevel);
    expect(runner.turns[0].spec.timeoutMs).toBe(snapshot.timeoutMs);
    expect(runner.turns[0].spec.prompt).toBe(created.prompt);

    await settle(runner.turns[0], child);
    await manager.idle();
    expect(row(parent, submitted.taskId).status).toBe("completed");
    expect(row(parent, submitted.taskId).result).toBe("done");
  });

  it("keeps one task history that the parent agent can read and tell apart", async () => {
    const { runner, manager } = setup();
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });

    const submitted = submitSubagentManualPrompt({
      childSessionId: child,
      message: "One more pass over the failing test.",
    });
    await runner.turns[0].acquire();
    await settle(runner.turns[0], child);
    await manager.idle();

    const history = listSubagentTasksForChildSession(parent, child);
    expect(history).toHaveLength(2);
    expect(history[0].taskId).toBe(submitted.taskId);
    expect(history[0].origin).toBe("manual");
    expect(history[1].origin).toBe("tool");
    // The seeded task keeps its own input and result untouched.
    expect(history[1].prompt).toBe("first input");
    expect(history[1].result).toBe("seeded result");

    const read = await subagentTool.execute!(
      "call-manual-get",
      { action: "get", session_id: child },
      undefined,
      undefined,
      {
        cwd: "/tmp/work",
        sessionManager: { getSessionId: () => parent },
      } as unknown as Parameters<NonNullable<typeof subagentTool.execute>>[4],
    );
    const text = read.content.map((item) => (item.type === "text" ? item.text ?? "" : "")).join("\n");
    expect(text).toContain(submitted.taskId);
    expect(text).toContain("manual");
  });

  it("refuses a manual input while the child already has an unfinished task", async () => {
    const { runner, manager } = setup();
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });

    const first = submitSubagentManualPrompt({ childSessionId: child, message: "first" });
    await runner.turns[0].acquire();

    expect(() => submitSubagentManualPrompt({ childSessionId: child, message: "second" }))
      .toThrow(SUBAGENT_SESSION_BUSY);

    const error = (() => {
      try {
        submitSubagentManualPrompt({ childSessionId: child, message: "third" });
        return null;
      } catch (caught) {
        return caught as SubagentManualInputError;
      }
    })();
    expect(error).toBeInstanceOf(SubagentManualInputError);
    expect(error?.code).toBe("busy");

    expect(unfinished(parent, child)).toHaveLength(1);
    expect(unfinished(parent, child)[0].taskId).toBe(first.taskId);
    await settle(runner.turns[0], child, { status: "cancelled", error: "stopped", hasReply: false });
    await manager.idle();
  });

  it("starts at most one task when a parent continue and a manual input race", async () => {
    const { runner, manager } = setup();
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });

    // Both entries reach the same synchronous busy check: whichever runs first
    // owns the child, the other is refused — never two overlapping turns.
    const delegated = manager.continue({
      parentSessionId: parent,
      childSessionId: child,
      description: "parent asked for more",
      prompt: "keep going",
    });
    let manualCode: string | null = null;
    try {
      submitSubagentManualPrompt({ childSessionId: child, message: "and also this" });
    } catch (caught) {
      manualCode = caught instanceof SubagentManualInputError ? caught.code : "other";
    }
    expect(manualCode).toBe("busy");
    expect(unfinished(parent, child)).toHaveLength(1);
    expect(unfinished(parent, child)[0].taskId).toBe(delegated.taskId);

    await settle(runner.turns[0], child);
    await manager.idle();
  });

  it("dedupes a retried manual submit by its request id", async () => {
    const { runner, manager } = setup();
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });

    const requestId = uniqueId("req");
    const first = submitSubagentManualPrompt({ childSessionId: child, message: "go", requestId });
    const retried = submitSubagentManualPrompt({ childSessionId: child, message: "go", requestId });

    expect(retried.taskId).toBe(first.taskId);
    expect(retried.deduped).toBe(true);
    // A retry never starts a second turn: only the seeded task plus the one the
    // request created exist for this child.
    expect(listSubagentTasksForChildSession(parent, child)).toHaveLength(2);

    const retriedAgain = submitSubagentManualPrompt({ childSessionId: child, message: "go", requestId });
    expect(retriedAgain.taskId).toBe(first.taskId);

    await runner.turns[0].acquire();
    await settle(runner.turns[0], child);
    await manager.idle();
    // A different session cannot be steered through a request id that belongs
    // to this one.
    const sibling = seedChildSession({ parent });
    expect(() => submitSubagentManualPrompt({ childSessionId: sibling.child, message: "go", requestId }))
      .toThrow(/already used for a different subagent session/);
  });

  it("is stopped by the parent's total stop and refused during the stop window", async () => {
    const { runner, manager } = setup();
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });

    const submitted = submitSubagentManualPrompt({ childSessionId: child, message: "background work" });
    await runner.turns[0].acquire();

    const stopped = manager.stopAll(parent);
    expect(stopped.stopped).toBe(1);
    expect(row(parent, submitted.taskId).status).toBe("stopping");

    expect(() => submitSubagentManualPrompt({ childSessionId: child, message: "sneak in" }))
      .toThrow(/stopping all subagent tasks/);

    await settle(runner.turns[0], child, {
      status: "cancelled",
      hasReply: false,
      error: "Subagent stopped because the parent session was stopped",
    });
    await manager.idle();
    expect(row(parent, submitted.taskId).status).toBe("cancelled");
    expect(manager.isStopping(parent)).toBe(false);
  });

  it("stops exactly the child session's unfinished task when the user stops it", async () => {
    const { runner, manager } = setup();
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });
    const other = seedChildSession({ parent, child: uniqueId("sibling") });

    const submitted = submitSubagentManualPrompt({ childSessionId: child, message: "long job" });
    await runner.turns[0].acquire();

    const stop = stopSubagentTaskForChildSession(child);
    expect(stop).toEqual({ taskId: submitted.taskId, status: "stopping" });
    expect(row(parent, `subagent:seed-${other.child}`).status).toBe("completed");

    await settle(runner.turns[0], child, {
      status: "cancelled",
      hasReply: false,
      error: "Subagent cancelled",
    });
    await manager.idle();
    expect(row(parent, submitted.taskId).status).toBe("cancelled");

    // An idle child session has nothing left to stop.
    expect(stopSubagentTaskForChildSession(child)).toBeNull();
  });

  it("recognises child sessions only", () => {
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });
    expect(isSubagentChildSession(child)).toBe(true);
    expect(isSubagentChildSession(parent)).toBe(false);
    expect(isSubagentChildSession(uniqueId("nothing"))).toBe(false);
  });

  it("adopts a live child wrapper and opens nothing it does not own", async () => {
    setup();
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });
    // Reading a child session must reuse the live wrapper (the one the task
    // manager is driving), not build a second session for the same id.
    const live = { isAlive: () => true } as never;
    registry().set(child, live);
    try {
      expect(await openSubagentChildSession(child)).toBe(live);
      // Not a child session, and a child whose session file is gone: nothing to
      // open, so the caller follows its ordinary path.
      expect(await openSubagentChildSession(parent)).toBeNull();
      expect(await openSubagentChildSession(uniqueId("nothing"))).toBeNull();
    } finally {
      registry().delete(child);
    }
  });

  it("derives a readable description and a fallback for empty input", () => {
    expect(manualTaskDescription("  check   the tests  \nmore")).toBe("check the tests");
    expect(manualTaskDescription("\n\n")).toBe("Manual follow-up");
    expect(manualTaskDescription("x".repeat(300)).length).toBeLessThanOrEqual(80);
  });

  it("refuses input it cannot deliver (no text, images)", () => {
    setup();
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });

    expect(() => submitSubagentManualPrompt({ childSessionId: child, message: "   " }))
      .toThrow(/must contain text/);
    expect(() => submitSubagentManualPrompt({ childSessionId: child, message: "look", hasImages: true }))
      .toThrow(/cannot carry images/);
    expect(listSubagentTasksForChildSession(parent, child)).toHaveLength(1);
  });
});

// ============================================================================
// The generic user-input entry
// ============================================================================

describe("/api/agent/[id] entry contract", () => {
  type RouteModule = typeof import("@/app/api/agent/[id]/route");
  let POST: RouteModule["POST"];

  beforeAll(async () => {
    ({ POST } = await import("@/app/api/agent/[id]/route"));
  });

  function post(id: string, body: unknown): Promise<Response> {
    return POST(
      new Request(`http://localhost/api/agent/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  it("routes a manual prompt into the task manager instead of an untracked turn", async () => {
    const { runner, manager } = setup();
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });

    const response = await post(child, { type: "prompt", message: "look at the diff too" });
    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; data: { taskId: string; origin: string } };
    expect(body.success).toBe(true);
    expect(body.data.origin).toBe("manual");

    const created = row(parent, body.data.taskId);
    expect(created.origin).toBe("manual");
    expect(created.childSessionId).toBe(child);
    expect(created.parentSessionId).toBe(parent);
    expect(created.prompt).toBe("look at the diff too");

    await runner.turns[0].acquire();
    await settle(runner.turns[0], child);
    await manager.idle();
  });

  it("returns busy instead of starting a second turn for the same child", async () => {
    const { runner, manager } = setup();
    const { child } = seedChildSession({ parent: uniqueId("parent") });

    await post(child, { type: "prompt", message: "first" });
    await runner.turns[0].acquire();

    const response = await post(child, { type: "prompt", message: "second" });
    expect(response.status).toBe(409);
    const body = await response.json() as { error: string };
    expect(body.error).toContain("busy");

    await settle(runner.turns[0], child, { status: "cancelled", error: "stopped", hasReply: false });
    await manager.idle();
  });

  it("maps a stop on the child session to its task instead of a raw abort", async () => {
    const { runner, manager } = setup();
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });

    const started = await post(child, { type: "prompt", message: "work" });
    const startedBody = await started.json() as { data: { taskId: string } };
    await runner.turns[0].acquire();

    const response = await post(child, { type: "abort" });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { stopped: boolean; taskId: string; status: string } };
    expect(body.data).toEqual({ stopped: true, taskId: startedBody.data.taskId, status: "stopping" });

    await settle(runner.turns[0], child, { status: "cancelled", error: "Subagent cancelled", hasReply: false });
    await manager.idle();
    expect(row(parent, startedBody.data.taskId).status).toBe("cancelled");
  });

  it("refuses images it cannot deliver to a task", async () => {
    setup();
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });
    const response = await post(child, {
      type: "prompt",
      message: "see attached",
      images: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
    });
    expect(response.status).toBe(400);
    expect(listSubagentTasksForChildSession(parent, child)).toHaveLength(1);
  });

  it("lets a stop fall through when the child has no tracked task", async () => {
    setup();
    const { parent, child } = seedChildSession({ parent: uniqueId("parent") });

    // Nothing is running: the abort is not a task stop, so the command follows
    // the ordinary session path (which cannot find this fake session file).
    const response = await post(child, { type: "abort" });
    expect(response.status).toBe(404);
    expect(row(parent, `subagent:seed-${child}`).status).toBe("completed");
  });

  it("leaves ordinary sessions on the normal path", async () => {
    setup();
    const { parent } = seedChildSession({ parent: uniqueId("parent") });
    // A parent session is not a child: a prompt there must never be turned into
    // a subagent task. It falls through to the normal path, which cannot find
    // the session file here — an error response proves the manual branch was not
    // taken (no task row was created).
    const response = await post(parent, { type: "prompt", message: "hello" });
    expect(response.status).toBe(404);
    expect(listSubagentTasksForChildSession(parent, parent)).toHaveLength(0);
  });
});

// ============================================================================
// Interaction gates
// ============================================================================

describe("subagent interaction gates", () => {
  it("fails ask_user_questions immediately in a subagent session", async () => {
    let bridgeCalled = false;
    const [tool] = buildAskUserQuestionsTool({
      source: "subagent",
      requestUserInput: () => {
        bridgeCalled = true;
        return new Promise(() => {});
      },
    });

    const result = await tool.execute!(
      "call-questions",
      {
        questions: [
          {
            question: "Which file?",
            header: "File",
            multiSelect: false,
            options: [
              { label: "a.ts", description: "The first file.", recommended: { reason: "closest" } },
              { label: "b.ts", description: "The second file." },
            ],
          },
        ],
      },
      undefined,
      undefined,
      {} as Parameters<NonNullable<typeof tool.execute>>[4],
    );

    const text = (result.content as Array<{ type: string; text?: string }>)
      .map((item) => (item.type === "text" ? item.text ?? "" : ""))
      .join("\n");
    expect(bridgeCalled).toBe(false);
    expect(text).toContain("unavailable");
    expect(text).toContain("subagent");
  });
});
