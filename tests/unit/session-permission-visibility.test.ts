import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;
let seq = 0;

function resetGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.__piSubagentsDb;
  delete g.__piSchedulerDb;
  delete g.__piSchedulerMigrated;
  delete g.__piSessions;
}

function useStores(): void {
  resetGlobals();
  seq += 1;
  root = mkdtempSync(join(tmpdir(), `pi-work-permission-visibility-${seq}-`));
  process.env.PI_WORK_SUBAGENTS_DB = join(root, "subagents.db");
  process.env.PI_WORK_SCHEDULER_DB = join(root, "scheduler.db");
  process.env.PI_WORK_DATA_DIR = join(root, "data");
}

beforeEach(() => {
  useStores();
});

afterEach(() => {
  resetGlobals();
  rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  resetGlobals();
  delete process.env.PI_WORK_SUBAGENTS_DB;
  delete process.env.PI_WORK_SCHEDULER_DB;
  delete process.env.PI_WORK_DATA_DIR;
});

describe("session permission visibility", () => {
  it("reads a foreground session from the sidecar", async () => {
    const { writeSessionPermissionMode } = await import("@/lib/server/session-permission-mode");
    const { resolveSessionPermission, sessionPermissionFields } = await import(
      "@/lib/server/session-permission-visibility"
    );

    writeSessionPermissionMode("foreground-full", "full_access");

    expect(resolveSessionPermission("foreground-full")).toEqual({
      permissionMode: "full_access",
      background: false,
    });
    expect(sessionPermissionFields(resolveSessionPermission("foreground-full"))).toEqual({
      permissionMode: "full_access",
    });
  });

  it("prefers the live wrapper's runtime mode over any stored source", async () => {
    const { AgentSessionWrapper } = await import("@/lib/server/rpc-manager");
    const { getRegistry } = await import("@/lib/server/session-registry");
    const { resolveSessionPermission } = await import("@/lib/server/session-permission-visibility");
    const inner = {
      sessionId: "live-background",
      sessionFile: undefined,
      isStreaming: false,
      isCompacting: false,
      systemPrompt: "",
      model: undefined,
      agent: { state: { messages: [] } },
      sessionManager: { getSessionName: () => null },
      getContextUsage: () => undefined,
    } as unknown as import("@/lib/server/pi-types").AgentSessionLike;
    getRegistry().set(
      "live-background",
      new AgentSessionWrapper(inner, "scheduled", null, "auto_deny", { background: true }),
    );

    expect(resolveSessionPermission("live-background")).toEqual({
      permissionMode: "auto_deny",
      background: true,
    });
  });

  it("uses a subagent task snapshot for a cold background session", async () => {
    const { createSubagentTask, markSubagentRunning } = await import("@/lib/server/subagent-store");
    const { resolveSessionPermission, sessionPermissionFields } = await import(
      "@/lib/server/session-permission-visibility"
    );

    const task = createSubagentTask({
      taskId: "0001",
      parentSessionId: "parent-session",
      subagentName: "codebase_explorer",
      description: "explore",
      prompt: "look around",
      configSnapshot: JSON.stringify({ permissionMode: "full_access" }),
    });
    markSubagentRunning("parent-session", task.taskId, "child-session");

    expect(resolveSessionPermission("child-session")).toEqual({
      permissionMode: "full_access",
      background: true,
    });
    expect(sessionPermissionFields(resolveSessionPermission("child-session"))).toEqual({
      permissionMode: "full_access",
      background: true,
    });
  });

  it("reads a legacy subagent snapshot without a mode as auto-deny", async () => {
    const { createSubagentTask, markSubagentRunning } = await import("@/lib/server/subagent-store");
    const { resolveSessionPermission } = await import("@/lib/server/session-permission-visibility");

    const task = createSubagentTask({
      taskId: "0001",
      parentSessionId: "parent-session",
      subagentName: "codebase_explorer",
      description: "explore",
      prompt: "look around",
      configSnapshot: JSON.stringify({ subagentName: "codebase_explorer" }),
    });
    markSubagentRunning("parent-session", task.taskId, "legacy-child");

    expect(resolveSessionPermission("legacy-child")).toEqual({
      permissionMode: "auto_deny",
      background: true,
    });
  });

  it("uses the scheduled task tier recorded when the run started", async () => {
    const { createTask, recordRunEnd, recordRunStart, updateTask } = await import(
      "@/lib/server/scheduler/store"
    );
    const { resolveSessionPermission, resolveSessionPermissions, sessionPermissionFields } = await import(
      "@/lib/server/session-permission-visibility"
    );

    const task = createTask({
      name: "Nightly",
      cron: "0 9 * * *",
      cwd: root,
      prompt: "build",
      permissionMode: "auto_deny",
    });
    const run = recordRunStart(task.id);
    recordRunEnd(run.id, { status: "success", sessionId: "scheduled-session" });
    updateTask({ id: task.id, permissionMode: "full_access" });

    expect(resolveSessionPermission("scheduled-session")).toEqual({
      permissionMode: "auto_deny",
      background: true,
    });
    expect(resolveSessionPermissions(["scheduled-session"])).toEqual({
      "scheduled-session": { permissionMode: "auto_deny", background: true },
    });
    expect(sessionPermissionFields(resolveSessionPermission("scheduled-session"))).toEqual({
      permissionMode: "auto_deny",
      background: true,
    });
  });

  it("reports an old run without a recorded tier as auto-deny", async () => {
    const { createTask, recordRunEnd, recordRunStart } = await import(
      "@/lib/server/scheduler/store"
    );
    const { getSchedulerDb } = await import("@/lib/server/scheduler/db");
    const { resolveSessionPermission } = await import(
      "@/lib/server/session-permission-visibility"
    );

    const task = createTask({
      name: "Nightly",
      cron: "0 9 * * *",
      cwd: root,
      prompt: "build",
      permissionMode: "full_access",
    });
    const run = recordRunStart(task.id);
    recordRunEnd(run.id, { status: "success", sessionId: "legacy-run" });
    getSchedulerDb().prepare("UPDATE task_runs SET permission_mode = NULL WHERE id = ?").run(run.id);

    expect(resolveSessionPermission("legacy-run")).toEqual({
      permissionMode: "auto_deny",
      background: true,
    });
  });

  it("resolves multiple subagent snapshots to the latest task in both single and batch paths", async () => {
    const { createSubagentTask, markSubagentRunning } = await import("@/lib/server/subagent-store");
    const { resolveSessionPermission, resolveSessionPermissions } = await import(
      "@/lib/server/session-permission-visibility"
    );

    const older = createSubagentTask({
      taskId: "0001",
      parentSessionId: "parent-session",
      subagentName: "codebase_explorer",
      description: "explore",
      prompt: "look around",
      configSnapshot: JSON.stringify({ permissionMode: "auto_deny" }),
    });
    markSubagentRunning("parent-session", older.taskId, "shared-child");
    const newer = createSubagentTask({
      taskId: "0002",
      parentSessionId: "parent-session",
      subagentName: "codebase_explorer",
      description: "explore again",
      prompt: "look around again",
      configSnapshot: JSON.stringify({ permissionMode: "full_access" }),
    });
    markSubagentRunning("parent-session", newer.taskId, "shared-child");

    expect(resolveSessionPermission("shared-child")).toEqual({
      permissionMode: "full_access",
      background: true,
    });
    expect(resolveSessionPermissions(["shared-child"])).toEqual({
      "shared-child": { permissionMode: "full_access", background: true },
    });
  });

  it("resolves many sessions at once with the same precedence", async () => {
    const { writeSessionPermissionMode } = await import("@/lib/server/session-permission-mode");
    const { createTask, recordRunEnd, recordRunStart } = await import(
      "@/lib/server/scheduler/store"
    );
    const { resolveSessionPermissions } = await import(
      "@/lib/server/session-permission-visibility"
    );

    writeSessionPermissionMode("foreground-full", "full_access");
    const task = createTask({
      name: "Nightly",
      cron: "0 9 * * *",
      cwd: root,
      prompt: "build",
      permissionMode: "full_access",
    });
    const run = recordRunStart(task.id);
    recordRunEnd(run.id, { status: "success", sessionId: "scheduled-full" });

    expect(resolveSessionPermissions(["foreground-full", "scheduled-full", "plain-session"])).toEqual({
      "foreground-full": { permissionMode: "full_access", background: false },
      "scheduled-full": { permissionMode: "full_access", background: true },
      "plain-session": { permissionMode: "confirm", background: false },
    });
  });
});
