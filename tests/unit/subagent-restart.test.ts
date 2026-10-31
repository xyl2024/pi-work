import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createChildSessionFactory,
  createScriptedRunner,
  type ScriptedTurn,
} from "./support/subagent-runtime";
import {
  createSubagentTaskManager,
  setSubagentTaskManagerForTests,
  type SubagentTaskManager,
} from "@/lib/server/subagent-tasks";
import {
  completeSubagentTask,
  createSubagentTask,
  getSubagentTask,
  getSubagentDb,
  hasSubagentStore,
  listSubagentTasks,
  markSubagentRunning,
  markSubagentStatus,
  reconcileInterruptedSubagentTasks,
  setSubagentTaskPartialOutput,
  type SubagentTask,
} from "@/lib/server/subagent-store";
import { bootstrap } from "@/lib/server/subagent-startup";
import {
  parseSubagentConfigSnapshot,
  resolveSubagentChildConfig,
  subagentChildSessionStartOptions,
} from "@/lib/server/subagent-restore";
import { createSubagentProfile, deleteSubagentProfile } from "@/lib/server/subagent-profiles";
import {
  deleteSessionToolSelection,
  writeSessionToolSelection,
} from "@/lib/server/session-tools-config";
import {
  setSubagentParentResolverForTests,
  subagentTool,
  type SubagentParentContext,
} from "@/lib/server/subagent-tool";
import {
  DEFAULT_SUBAGENT_BOT,
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  type SubagentTaskConfigSnapshot,
} from "@/lib/shared/subagent";
import { WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from "@/lib/shared/web-tools";

let root: string;
let agentDir: string;
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
  delete g.__piSessionPathCache;
  delete g.__piSessionListCache;
  delete g.__piSessionListHeaderCache;
  delete g.__piSessionListInflight;
  delete g.__piSessionListHeaderInflight;
  delete g.__piSubagentStatsCache;
  delete g.__piSubagentLiveCache;
  delete g.__piSubagentStartupReconciled;
}

function simulateRestart(): void {
  resetGlobals();
}

function removeStore(): void {
  const dbPath = process.env.PI_WORK_SUBAGENTS_DB!;
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-work-subagent-restart-case-"));
  agentDir = join(root, "agent");
  mkdirSync(agentDir, { recursive: true });
  process.env.PI_WORK_SUBAGENTS_DB = join(root, "subagents.db");
  process.env.PI_WORK_DATA_DIR = join(root, "data");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  resetGlobals();
});

afterEach(() => {
  setSubagentTaskManagerForTests(null);
  setSubagentParentResolverForTests(null);
  resetGlobals();
  removeStore();
  rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  delete process.env.PI_WORK_SUBAGENTS_DB;
  delete process.env.PI_WORK_DATA_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
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
  return subagentTool.execute!("call-restart", params, undefined, undefined, fakeContext(parentSessionId));
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((item) => (item.type === "text" ? item.text ?? "" : "")).join("\n");
}

function startManager(options: { reconcileOnCreate?: boolean } = {}) {
  const runner = createScriptedRunner();
  const child = createChildSessionFactory();
  const manager: SubagentTaskManager = createSubagentTaskManager({
    runTurn: runner.runTurn,
    createChildSession: child.factory,
    reconcileOnCreate: options.reconcileOnCreate ?? false,
  });
  setSubagentTaskManagerForTests(manager);
  setSubagentParentResolverForTests(async (id) => parentContext(id));
  return { runner, child, manager };
}

async function settle(turn: ScriptedTurn, childSessionId: string, text = "done"): Promise<void> {
  await turn.settle({ text, realSessionId: childSessionId });
}

async function waitFor(assertion: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function row(parentSessionId: string, taskId: string): SubagentTask {
  const task = getSubagentTask(parentSessionId, taskId);
  if (!task) throw new Error(`missing task ${taskId}`);
  return task;
}

function seedTask(input: {
  parent: string;
  child?: string | null;
  status: "queued" | "creating" | "running" | "stopping";
  result?: string;
}): SubagentTask {
  const childSessionId = input.child ?? null;
  const created = createSubagentTask({
    taskId: `subagent:${unique("task")}`,
    parentSessionId: input.parent,
    childSessionId,
    subagentName: "codebase_explorer",
    description: `leftover ${input.status}`,
    prompt: "original input",
  });
  if (input.status !== "queued") markSubagentRunning(input.parent, created.taskId, childSessionId!);
  if (input.status === "creating") markSubagentStatus(input.parent, created.taskId, "creating");
  if (input.status === "stopping") markSubagentStatus(input.parent, created.taskId, "stopping");
  if (input.result) setSubagentTaskPartialOutput(input.parent, created.taskId, input.result);
  return row(input.parent, created.taskId);
}

const snapshot: SubagentTaskConfigSnapshot = {
  subagentName: "codebase_explorer",
  cwd: "/tmp/work",
  model: { provider: "p", modelId: "m-snapshot" },
  thinkingLevel: "high",
  permissionMode: "full_access",
  tools: ["read"],
  systemPrompt: { kind: "prefix", text: "Explore only." },
  timeoutMs: 12_345,
};

function seedFinishedChild(input: { parent: string; child: string; taskId?: string }): SubagentTask {
  const taskId = input.taskId ?? `subagent:${unique("seeded")}`;
  createSubagentTask({
    taskId,
    parentSessionId: input.parent,
    childSessionId: input.child,
    subagentName: snapshot.subagentName,
    description: "seeded task",
    prompt: "first input",
    configSnapshot: JSON.stringify(snapshot),
  });
  markSubagentRunning(input.parent, taskId, input.child);
  completeSubagentTask(input.parent, taskId, "first answer");
  return row(input.parent, taskId);
}

function seedLegacyChild(parent: string, child: string): SubagentTask {
  const taskId = `subagent:${unique("legacy")}`;
  createSubagentTask({
    taskId,
    parentSessionId: parent,
    childSessionId: child,
    subagentName: "codebase_explorer",
    description: "old task",
    prompt: "old input",
    configSnapshot: null,
  });
  markSubagentRunning(parent, taskId, child);
  completeSubagentTask(parent, taskId, "legacy answer");
  return row(parent, taskId);
}

function writeLegacyChildSession(input: {
  sessionId: string;
  cwd: string;
  model: { provider: string; modelId: string };
  thinkingLevel?: string;
  text?: string;
}): string {
  const dir = join(agentDir, "sessions", "--tmp-legacy-project--");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${input.sessionId}.jsonl`);
  const timestamp = "2026-01-02T03:04:05.000Z";
  const entries: string[] = [];
  let parentId: string | null = null;
  if (input.thinkingLevel) {
    entries.push(JSON.stringify({
      type: "thinking_level_change",
      id: "t1",
      parentId,
      timestamp,
      thinkingLevel: input.thinkingLevel,
    }) + "\n");
    parentId = "t1";
  }
  entries.push(JSON.stringify({
    type: "message",
    id: "m1",
    parentId,
    timestamp,
    message: {
      role: "assistant",
      provider: input.model.provider,
      model: input.model.modelId,
      content: [{ type: "text", text: input.text ?? "legacy answer" }],
      timestamp: 1,
    },
  }) + "\n");
  writeFileSync(filePath, [
    JSON.stringify({ type: "session", version: 3, id: input.sessionId, timestamp, cwd: input.cwd }) + "\n",
    ...entries,
  ].join(""), "utf8");
  return filePath;
}

describe("startup reconciliation", () => {
  it("marks every leftover non-terminal task interrupted on boot, idempotently, keeping history", async () => {
    const parent = unique("parent-reconcile");
    const queued = seedTask({ parent, status: "queued" });
    const creating = seedTask({ parent, child: unique("child"), status: "creating" });
    const running = seedTask({ parent, child: unique("child"), status: "running", result: "partial output" });
    const stopping = seedTask({ parent, child: unique("child"), status: "stopping" });
    const completed = createSubagentTask({
      taskId: `subagent:${unique("done")}`,
      parentSessionId: parent,
      childSessionId: unique("child"),
      subagentName: "codebase_explorer",
      description: "finished before the restart",
      prompt: "old input",
    });
    markSubagentRunning(parent, completed.taskId, getSubagentTask(parent, completed.taskId)!.childSessionId!);
    completeSubagentTask(parent, completed.taskId, "old answer");

    simulateRestart();
    expect(hasSubagentStore()).toBe(true);
    bootstrap();

    for (const task of [queued, creating, running, stopping]) {
      const reconciled = row(parent, task.taskId);
      expect(reconciled.status).toBe("interrupted");
      expect(reconciled.error).toContain("restarted");
      expect(reconciled.finishedAt).toBeTypeOf("number");
      expect(reconciled.prompt).toBe("original input");
    }
    expect(row(parent, running.taskId).result).toBe("partial output");
    expect(row(parent, completed.taskId)).toMatchObject({ status: "completed", result: "old answer", error: null });
    expect(listSubagentTasks(parent)).toHaveLength(5);

    const finishedAt = row(parent, running.taskId).finishedAt;
    bootstrap();
    expect(reconcileInterruptedSubagentTasks()).toBe(0);
    expect(row(parent, running.taskId)).toMatchObject({
      status: "interrupted",
      finishedAt,
      result: "partial output",
    });

    const { runner, manager } = startManager({ reconcileOnCreate: true });
    await manager.idle();
    expect(runner.turns).toHaveLength(0);
  });

  it("does not create a store just to reconcile nothing", async () => {
    removeStore();
    expect(hasSubagentStore()).toBe(false);
    bootstrap();
    expect(existsSync(process.env.PI_WORK_SUBAGENTS_DB!)).toBe(false);
  });
});

describe("after a restart", () => {
  it("list/get report interrupted and an interrupted child can be continued explicitly", async () => {
    const parent = unique("parent-view");
    const child = unique("child");
    const leftover = seedTask({ parent, child, status: "running" });
    getSubagentDb().prepare("UPDATE subagent_tasks SET config_snapshot = ? WHERE task_id = ?")
      .run(JSON.stringify(snapshot), leftover.taskId);

    simulateRestart();
    bootstrap();
    const { runner, manager } = startManager();

    const listed = await run({ action: "list", status: "interrupted", limit: 10 }, parent);
    expect(listed.isError).toBeUndefined();
    const entries = (listed.details as { entries: Array<{ sessionId: string; latestTask: { status: string } }> }).entries;
    expect(entries.map((entry) => entry.sessionId)).toEqual([child]);
    expect(entries[0].latestTask.status).toBe("interrupted");

    const got = await run({ action: "get", session_id: child }, parent);
    expect(got.isError).toBeUndefined();
    const detail = (got.details as { detail: { task: { taskId: string; status: string; error: string | null } } }).detail;
    expect(detail.task).toMatchObject({ taskId: leftover.taskId, status: "interrupted" });
    expect(detail.task.error).toContain("restarted");

    const continued = await run(
      { action: "continue", session_id: child, prompt: "pick it up", wait_ms: 0 },
      parent,
    );
    expect(continued.isError).toBeUndefined();
    const continuedId = (continued.details as { taskId: string }).taskId;
    expect(runner.turns).toHaveLength(1);
    expect(runner.turns[0].spec.session).toEqual({ kind: "reuse", sessionId: child });
    await runner.turns[0].acquire();
    await settle(runner.turns[0], child, "continued answer");
    await manager.idle();

    expect(row(parent, leftover.taskId)).toMatchObject({ status: "interrupted", result: null });
    expect(row(parent, continuedId)).toMatchObject({ status: "completed", result: "continued answer" });
    const after = await run({ action: "get", session_id: child }, parent);
    const history = (after.details as { tasks: { items: Array<{ taskId: string }> } }).tasks;
    expect(history.items.map((task) => task.taskId)).toEqual([continuedId, leftover.taskId]);
  });

  it("restores the creation-time snapshot across a restart, even after the profile is deleted", async () => {
    createSubagentProfile({
      name: "restart-worker",
      description: "worker",
      systemPrompt: "Work only.",
      inheritSystemPrompt: false,
      tools: ["read", "edit", WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME],
      model: { provider: "p", modelId: "m-profile" },
      thinkingLevel: "low",
      bot: DEFAULT_SUBAGENT_BOT,
      timeoutMs: 23_456,
    });
    const parent = unique("parent-cold");
    const { runner, manager } = startManager({ reconcileOnCreate: true });

    const spawned = await run(
      { action: "spawn", subagent_name: "restart-worker", description: "do work", prompt: "go", wait_ms: 0 },
      parent,
    );
    expect(spawned.isError).toBeUndefined();
    const taskId = (spawned.details as { taskId: string }).taskId;
    await runner.turns[0].acquire();
    const child = manager.get(parent, taskId)!.childSessionId!;
    await settle(runner.turns[0], child);
    await manager.idle();
    expect(deleteSubagentProfile("restart-worker")).toBe(true);

    simulateRestart();
    const restarted = startManager({ reconcileOnCreate: true });
    const continued = await run(
      { action: "continue", session_id: child, prompt: "again", wait_ms: 0 },
      parent,
    );
    expect(continued.isError).toBeUndefined();
    expect(restarted.runner.turns).toHaveLength(1);
    expect(restarted.runner.turns[0].spec).toMatchObject({
      model: { provider: "p", modelId: "m-profile" },
      thinkingLevel: "low",
      timeoutMs: 23_456,
      source: "subagent",
    });
    const persisted = parseSubagentConfigSnapshot(
      row(parent, (continued.details as { taskId: string }).taskId).configSnapshot,
    );
    expect(persisted).toMatchObject({
      subagentName: "restart-worker",
      tools: ["read", "edit", WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME],
      systemPrompt: { kind: "prefix", text: "Work only.\n\nYour current working directory is /tmp/work" },
    });
    expect(persisted).not.toBeNull();
    if (!persisted) return;
    expect(subagentChildSessionStartOptions(persisted, parent).allowedToolNames).toEqual([
      "read",
      "edit",
      WEB_SEARCH_TOOL_NAME,
      WEB_FETCH_TOOL_NAME,
    ]);
    await restarted.runner.turns[0].acquire();
    await settle(restarted.runner.turns[0], child, "second answer");
    await restarted.manager.idle();
  });

  it("starts a cold session with the frozen config and never re-adds the subagent tool", async () => {
    const config = subagentChildSessionStartOptions(
      { ...snapshot, tools: ["read", "subagent", "spawn_subagent"] },
      "parent-options",
    );
    expect(config).toMatchObject({
      model: snapshot.model,
      thinkingLevel: snapshot.thinkingLevel,
      permissionMode: "full_access",
      allowedToolNames: ["read"],
      systemPromptPrefix: snapshot.systemPrompt.kind === "prefix" ? snapshot.systemPrompt.text : "",
      stripDefaultSystemPromptSections: true,
      parentSessionId: "parent-options",
    });
    expect(config.allowedToolNames).not.toContain("subagent");
    expect(config.allowedToolNames).not.toContain("spawn_subagent");
  });
});

describe("permission mode in the frozen config", () => {
  it("reads a snapshot without a permission mode as auto deny and carries it into the start options", () => {
    const legacySnapshot: Record<string, unknown> = { ...snapshot };
    delete legacySnapshot.permissionMode;
    const parsed = parseSubagentConfigSnapshot(JSON.stringify(legacySnapshot));
    expect(parsed?.permissionMode).toBe("auto_deny");
    expect(subagentChildSessionStartOptions(parsed!, "parent-legacy-mode").permissionMode).toBe("auto_deny");

    const invalid = parseSubagentConfigSnapshot(JSON.stringify({ ...legacySnapshot, permissionMode: "confirm" }));
    expect(invalid?.permissionMode).toBe("auto_deny");
  });

  it("keeps the snapshot mode when a child session is reopened", async () => {
    const parent = unique("parent-cold-mode");
    const child = unique("child-cold-mode");
    createSubagentTask({
      parentSessionId: parent,
      childSessionId: child,
      subagentName: snapshot.subagentName,
      description: "cold mode",
      prompt: "first input",
      configSnapshot: JSON.stringify(snapshot),
    });

    const reopened = await resolveSubagentChildConfig({
      parentSessionId: parent,
      childSessionId: child,
      subagentName: snapshot.subagentName,
    });
    expect(reopened.source).toBe("snapshot");
    expect(reopened.config.permissionMode).toBe("full_access");
    expect(subagentChildSessionStartOptions(reopened.config, parent).permissionMode).toBe("full_access");
  });
});

describe("legacy rows without a configuration snapshot", () => {
  it("recovers only the restricted facts the persisted session proves", async () => {
    const parent = unique("parent-legacy");
    const child = unique("child");
    writeLegacyChildSession({
      sessionId: child,
      cwd: "/tmp/legacy-project",
      model: { provider: "p", modelId: "m-legacy" },
      thinkingLevel: "low",
      text: "legacy answer",
    });
    writeSessionToolSelection(child, ["read", "bash", "subagent", "spawn_subagent"]);
    const seeded = createSubagentTask({
      taskId: `subagent:${unique("legacy")}`,
      parentSessionId: parent,
      childSessionId: child,
      subagentName: "codebase_explorer",
      description: "old task",
      prompt: "old input",
      configSnapshot: null,
    });
    markSubagentRunning(parent, seeded.taskId, child);
    completeSubagentTask(parent, seeded.taskId, "legacy answer");

    simulateRestart();
    bootstrap();
    const { runner, manager } = startManager({ reconcileOnCreate: true });

    const continued = await run(
      { action: "continue", session_id: child, prompt: "carry on", wait_ms: 0 },
      parent,
    );
    expect(continued.isError).toBeUndefined();
    const newTaskId = (continued.details as { taskId: string }).taskId;

    await waitFor(() => runner.turns.length === 1, "the recovered turn");
    expect(runner.turns[0].spec).toMatchObject({
      cwd: "/tmp/legacy-project",
      model: { provider: "p", modelId: "m-legacy" },
      thinkingLevel: "low",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      session: { kind: "reuse", sessionId: child },
      prompt: "carry on",
    });

    const recovered = parseSubagentConfigSnapshot(row(parent, newTaskId).configSnapshot);
    expect(recovered).toMatchObject({
      subagentName: "codebase_explorer",
      cwd: "/tmp/legacy-project",
      model: { provider: "p", modelId: "m-legacy" },
      thinkingLevel: "low",
      permissionMode: "auto_deny",
      tools: ["read", "bash"],
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
    });
    expect(recovered!.systemPrompt.kind).toBe("prefix");

    await runner.turns[0].acquire();
    await settle(runner.turns[0], child, "carried on");
    await manager.idle();

    expect(row(parent, seeded.taskId)).toMatchObject({ status: "completed", result: "legacy answer", prompt: "old input" });

    deleteSessionToolSelection(child);
    simulateRestart();
    const restarted = startManager({ reconcileOnCreate: true });
    const again = await run(
      { action: "continue", session_id: child, prompt: "once more", wait_ms: 0 },
      parent,
    );
    expect(again.isError).toBeUndefined();
    await waitFor(() => restarted.runner.turns.length === 1, "the frozen turn");
    expect(restarted.runner.turns[0].spec).toMatchObject({
      model: { provider: "p", modelId: "m-legacy" },
      thinkingLevel: "low",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
    });
    await restarted.runner.turns[0].acquire();
    await settle(restarted.runner.turns[0], child, "third answer");
    await restarted.manager.idle();

    const resolved = await resolveSubagentChildConfig({
      parentSessionId: parent,
      childSessionId: child,
      subagentName: "codebase_explorer",
    });
    expect(resolved.source).toBe("snapshot");
    expect(resolved.config).toEqual(recovered);
  });

  it("refuses synchronously when the tool set is already known to be unrecoverable", async () => {
    const parent = unique("parent-legacy-tools");
    const { runner, manager } = startManager({ reconcileOnCreate: true });

    const noToolsChild = unique("child");
    writeLegacyChildSession({
      sessionId: noToolsChild,
      cwd: "/tmp/legacy-project",
      model: { provider: "p", modelId: "m-legacy" },
    });
    seedLegacyChild(parent, noToolsChild);

    const allToolsChild = unique("child");
    writeLegacyChildSession({
      sessionId: allToolsChild,
      cwd: "/tmp/legacy-project",
      model: { provider: "p", modelId: "m-legacy" },
    });
    writeSessionToolSelection(allToolsChild, "all");
    seedLegacyChild(parent, allToolsChild);

    const cases = [
      { child: noToolsChild, expected: "no recorded tool selection" },
      { child: allToolsChild, expected: "ran with every tool" },
    ] as const;

    for (const testCase of cases) {
      const attempted = await run(
        { action: "continue", session_id: testCase.child, prompt: "continue anyway", wait_ms: 0 },
        parent,
      );
      expect(attempted.isError).toBe(true);
      expect(textOf(attempted)).toContain(testCase.expected);
    }

    expect(listSubagentTasks(parent)).toHaveLength(2);
    expect(runner.turns).toHaveLength(0);
    await manager.idle();
  });

  it("fails a task that cannot prove its session file, model or working directory", async () => {
    const parent = unique("parent-legacy-gap");
    const { runner, manager } = startManager({ reconcileOnCreate: true });

    const goneChild = unique("child");
    writeSessionToolSelection(goneChild, ["read"]);
    seedLegacyChild(parent, goneChild);

    const noCwdChild = unique("child");
    const noCwdFile = writeLegacyChildSession({
      sessionId: noCwdChild,
      cwd: "",
      model: { provider: "p", modelId: "m-legacy" },
    });
    writeSessionToolSelection(noCwdChild, ["read"]);
    expect(noCwdFile).toContain(noCwdChild);
    seedLegacyChild(parent, noCwdChild);

    const noModelChild = unique("child");
    const noModelFile = join(agentDir, "sessions", "--tmp-legacy-project--", `${noModelChild}.jsonl`);
    mkdirSync(join(agentDir, "sessions", "--tmp-legacy-project--"), { recursive: true });
    writeFileSync(noModelFile, JSON.stringify({
      type: "session",
      version: 3,
      id: noModelChild,
      timestamp: "2026-01-02T03:04:05.000Z",
      cwd: "/tmp/legacy-project",
    }) + "\n", "utf8");
    writeSessionToolSelection(noModelChild, ["read"]);
    seedLegacyChild(parent, noModelChild);

    const cases = [
      { child: goneChild, expected: "session file is gone" },
      { child: noCwdChild, expected: "no working directory" },
      { child: noModelChild, expected: "no recorded model" },
    ] as const;

    for (const testCase of cases) {
      const attempted = await run(
        { action: "continue", session_id: testCase.child, prompt: "continue anyway", wait_ms: 0 },
        parent,
      );
      expect(attempted.isError).toBeUndefined();
      const taskId = (attempted.details as { taskId: string }).taskId;
      await waitFor(() => row(parent, taskId).status === "failed", `task ${taskId} to fail`);
      expect(row(parent, taskId).error).toContain(testCase.expected);
      expect(row(parent, taskId).configSnapshot).toBeNull();
      const got = await run({ action: "get", task_id: taskId }, parent);
      const detail = (got.details as { detail: { task: { status: string; error: string | null } } }).detail;
      expect(detail.task.status).toBe("failed");
      expect(detail.task.error).toContain(testCase.expected);
    }

    expect(runner.turns).toHaveLength(0);
    await manager.idle();
  });

  it("never opens the child session when a stop lands during legacy recovery", async () => {
    const parent = unique("parent-legacy-stop");
    const child = unique("child");
    writeLegacyChildSession({
      sessionId: child,
      cwd: "/tmp/legacy-project",
      model: { provider: "p", modelId: "m-legacy" },
    });
    writeSessionToolSelection(child, ["read"]);
    seedLegacyChild(parent, child);

    const { runner, manager } = startManager({ reconcileOnCreate: true });
    const continued = await run(
      { action: "continue", session_id: child, prompt: "carry on", wait_ms: 0 },
      parent,
    );
    expect(continued.isError).toBeUndefined();
    const taskId = (continued.details as { taskId: string }).taskId;

    manager.stop(parent, taskId);
    await waitFor(() => row(parent, taskId).status === "cancelled", "the task to cancel");
    expect(runner.turns).toHaveLength(0);
    expect(row(parent, taskId).childSessionId).toBe(child);
    await manager.idle();
  });
});

describe("request-id dedupe across a restart", () => {
  it("returns the original task for a retried spawn/continue and starts new work for a new id", async () => {
    createSubagentProfile({
      name: "restart-worker",
      description: "worker",
      systemPrompt: "Work only.",
      inheritSystemPrompt: false,
      tools: ["read"],
      model: { provider: "p", modelId: "m-profile" },
      thinkingLevel: "low",
      bot: DEFAULT_SUBAGENT_BOT,
      timeoutMs: 12_345,
    });
    const parent = unique("parent-dedupe");
    const first = startManager({ reconcileOnCreate: true });

    const spawnParams = {
      action: "spawn" as const,
      subagent_name: "restart-worker",
      description: "first work",
      prompt: "do the thing",
      wait_ms: 0,
      request_id: "restart-spawn",
    };
    const spawned = await run(spawnParams, parent);
    expect(spawned.isError).toBeUndefined();
    const firstTaskId = (spawned.details as { taskId: string }).taskId;
    await first.runner.turns[0].acquire();
    const child = first.manager.get(parent, firstTaskId)!.childSessionId!;
    await settle(first.runner.turns[0], child);
    await first.manager.idle();

    simulateRestart();
    const second = startManager({ reconcileOnCreate: true });
    const retried = await run(spawnParams, parent);
    expect(retried.isError).toBeUndefined();
    expect((retried.details as { taskId: string }).taskId).toBe(firstTaskId);
    expect(second.runner.turns).toHaveLength(0);

    const fresh = await run({ ...spawnParams, prompt: "another thing", request_id: "restart-spawn-2" }, parent);
    expect(fresh.isError).toBeUndefined();
    expect((fresh.details as { taskId: string }).taskId).not.toBe(firstTaskId);
    await waitFor(() => second.runner.turns.length === 1, "the new spawn turn");
    await second.runner.turns[0].acquire();
    await settle(second.runner.turns[0], child);
    await second.manager.idle();

    const continueParams = {
      action: "continue" as const,
      session_id: child,
      prompt: "one follow-up",
      wait_ms: 0,
      request_id: "restart-continue",
    };
    const continued = await run(continueParams, parent);
    expect(continued.isError).toBeUndefined();
    const continuedId = (continued.details as { taskId: string }).taskId;
    await waitFor(() => second.runner.turns.length === 2, "the continued turn");
    await second.runner.turns[1].acquire();
    await settle(second.runner.turns[1], child);
    await second.manager.idle();

    simulateRestart();
    const third = startManager({ reconcileOnCreate: true });
    const retriedContinue = await run(continueParams, parent);
    expect(retriedContinue.isError).toBeUndefined();
    expect((retriedContinue.details as { taskId: string }).taskId).toBe(continuedId);
    expect(third.runner.turns).toHaveLength(0);

    const nextContinue = await run({ ...continueParams, prompt: "second follow-up", request_id: "restart-continue-2" }, parent);
    expect(nextContinue.isError).toBeUndefined();
    expect((nextContinue.details as { taskId: string }).taskId).not.toBe(continuedId);
    await waitFor(() => third.runner.turns.length === 1, "the next continue turn");
    await third.runner.turns[0].acquire();
    await settle(third.runner.turns[0], child);
    await third.manager.idle();

    const otherChild = unique("child");
    seedFinishedChild({ parent, child: otherChild });
    const mismatch = await run(
      { action: "continue", session_id: otherChild, prompt: "one follow-up", wait_ms: 0, request_id: "restart-continue" },
      parent,
    );
    expect(mismatch.isError).toBe(true);
    expect(textOf(mismatch)).toContain("different subagent session");
  });
});

describe("store migration across restarts", () => {
  it("adds the newer columns idempotently and keeps legacy rows readable", () => {
    removeStore();
    const dbPath = process.env.PI_WORK_SUBAGENTS_DB!;
    const legacy = new Database(dbPath);
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
        created_at       INTEGER NOT NULL,
        started_at       INTEGER,
        finished_at      INTEGER
      )
    `);
    legacy.prepare(`
      INSERT INTO subagent_tasks
        (task_id, parent_session_id, child_session_id, subagent_name, description, prompt, status, created_at)
      VALUES ('legacy-task', 'parent-legacy-db', 'child-legacy-db', 'codebase_explorer', 'old', 'old input', 'completed', 1)
    `).run();
    legacy.close();

    const columns = () => (getSubagentDb().prepare("PRAGMA table_info(subagent_tasks)").all() as Array<{ name: string }>)
      .map((column) => column.name);

    expect(columns()).toEqual(expect.arrayContaining(["origin", "request_id", "config_snapshot"]));
    expect(row("parent-legacy-db", "legacy-task")).toMatchObject({
      status: "completed",
      origin: "tool",
      requestId: null,
      configSnapshot: null,
      prompt: "old input",
    });

    bootstrap();
    simulateRestart();
    const reopened = getSubagentDb();
    expect(columns()).toEqual(expect.arrayContaining(["origin", "request_id", "config_snapshot"]));
    expect(row("parent-legacy-db", "legacy-task")).toMatchObject({ status: "completed", result: null, prompt: "old input" });
    expect((reopened.prepare("PRAGMA index_list(subagent_tasks)").all() as Array<{ name: string }>)
      .map((index) => index.name)).toContain("idx_subagent_tasks_request");
  });
});
