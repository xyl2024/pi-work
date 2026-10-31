import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let counter = 0;

const LEGACY_SCHEMA = `
  CREATE TABLE scheduled_tasks (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    cron            TEXT NOT NULL,
    cwd             TEXT NOT NULL,
    prompt          TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    provider        TEXT,
    model_id        TEXT,
    thinking_level  TEXT,
    tool_names      TEXT,
    max_lifetime_ms INTEGER,
    timezone        TEXT,
    notification    TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    last_run_at     INTEGER,
    next_run_at     INTEGER
  );
  CREATE TABLE task_runs (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    status      TEXT NOT NULL,
    reply_text  TEXT,
    error       TEXT,
    session_id  TEXT,
    duration_ms INTEGER,
    FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_task_runs_task_started ON task_runs(task_id, started_at DESC);
  CREATE INDEX idx_scheduled_tasks_enabled_next ON scheduled_tasks(enabled, next_run_at);
`;

function resetSchedulerGlobals(): void {
  const g = globalThis as {
    __piSchedulerDb?: { close: () => void };
    __piSchedulerMigrated?: boolean;
  };
  g.__piSchedulerDb?.close();
  delete g.__piSchedulerDb;
  delete g.__piSchedulerMigrated;
}

function useDatabase(name: string): string {
  resetSchedulerGlobals();
  const path = join(dir, `${name}.db`);
  process.env.PI_WORK_SCHEDULER_DB = path;
  return path;
}

function legacyDatabase(name: string): string {
  resetSchedulerGlobals();
  const path = join(dir, `${name}.db`);
  const db = new Database(path);
  db.exec(LEGACY_SCHEMA);
  db.prepare(
    `INSERT INTO scheduled_tasks
       (id, name, cron, cwd, prompt, enabled, created_at, updated_at)
     VALUES ('legacy-1', 'Nightly', '0 9 * * *', ?, 'hello', 1, 1, 1)`,
  ).run(dir);
  db.close();
  process.env.PI_WORK_SCHEDULER_DB = path;
  return path;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-scheduler-permission-"));
  process.env.PI_WORK_LOG_FILE = "off";
});

beforeEach(() => {
  useDatabase(`db-${++counter}`);
});

afterAll(() => {
  resetSchedulerGlobals();
  delete process.env.PI_WORK_SCHEDULER_DB;
  delete process.env.PI_WORK_LOG_FILE;
  rmSync(dir, { recursive: true, force: true });
});

function minimalTask(permissionMode?: unknown) {
  return {
    name: "Nightly",
    cron: "0 9 * * *",
    cwd: dir,
    prompt: "do the thing",
    ...(permissionMode === undefined ? {} : { permissionMode: permissionMode as never }),
  };
}

describe("scheduled task permission mode storage", () => {
  it("defaults a new task to auto-deny", async () => {
    const { createTask } = await import("@/lib/server/scheduler/store");
    const task = createTask(minimalTask());
    expect(task.permissionMode).toBe("auto_deny");
  });

  it("round-trips both background modes", async () => {
    const { createTask, getTask, updateTask } = await import("@/lib/server/scheduler/store");

    const full = createTask(minimalTask("full_access"));
    expect(full.permissionMode).toBe("full_access");
    expect(getTask(full.id)?.permissionMode).toBe("full_access");

    const auto = createTask(minimalTask("auto_deny"));
    expect(auto.permissionMode).toBe("auto_deny");

    const updated = updateTask({ id: auto.id, permissionMode: "full_access" });
    expect(updated.permissionMode).toBe("full_access");
    expect(getTask(auto.id)?.permissionMode).toBe("full_access");
  });

  it("rejects confirm, empty and unknown values instead of defaulting to full access", async () => {
    const { createTask, updateTask, SchedulerValidationError } = await import(
      "@/lib/server/scheduler/store"
    );

    for (const bad of ["confirm", "", "yolo", null, 1]) {
      expect(() => createTask(minimalTask(bad))).toThrow(SchedulerValidationError);
    }

    const task = createTask(minimalTask("auto_deny"));
    for (const bad of ["confirm", "", "yolo", null]) {
      expect(() => updateTask({ id: task.id, permissionMode: bad as never })).toThrow(
        SchedulerValidationError,
      );
    }
  });

  it("reads a legacy row without the column as auto-deny", async () => {
    legacyDatabase("legacy-scheduler");
    const { getTask, listTasks } = await import("@/lib/server/scheduler/store");

    expect(getTask("legacy-1")?.permissionMode).toBe("auto_deny");
    expect(listTasks().map((task) => task.permissionMode)).toEqual(["auto_deny"]);
  });

  it("treats a NULL or unrecognised stored value as auto-deny", async () => {
    const { getSchedulerDb } = await import("@/lib/server/scheduler/db");
    const { createTask, getTask } = await import("@/lib/server/scheduler/store");

    const task = createTask(minimalTask("full_access"));
    const db = getSchedulerDb();
    db.prepare("UPDATE scheduled_tasks SET permission_mode = NULL WHERE id = ?").run(task.id);
    expect(getTask(task.id)?.permissionMode).toBe("auto_deny");

    db.prepare("UPDATE scheduled_tasks SET permission_mode = 'yolo' WHERE id = ?").run(task.id);
    expect(getTask(task.id)?.permissionMode).toBe("auto_deny");
  });

  it("records the task's tier on the run when it starts", async () => {
    const { createTask, recordRunStart } = await import("@/lib/server/scheduler/store");
    const { getSchedulerDb } = await import("@/lib/server/scheduler/db");

    const full = createTask(minimalTask("full_access"));
    const auto = createTask(minimalTask("auto_deny"));
    const fullRun = recordRunStart(full.id);
    const autoRun = recordRunStart(auto.id);
    const rows = getSchedulerDb()
      .prepare("SELECT id, permission_mode FROM task_runs")
      .all() as Array<{ id: string; permission_mode: string | null }>;

    expect(rows.find((row) => row.id === fullRun.id)?.permission_mode).toBe("full_access");
    expect(rows.find((row) => row.id === autoRun.id)?.permission_mode).toBe("auto_deny");
  });

  it("adds both permission columns to an old database idempotently", async () => {
    legacyDatabase("legacy-idempotent");
    const { getSchedulerDb } = await import("@/lib/server/scheduler/db");

    getSchedulerDb();
    resetSchedulerGlobals();
    const db = getSchedulerDb();
    const taskColumns = db.prepare("PRAGMA table_info(scheduled_tasks)").all() as Array<{ name: string }>;
    const runColumns = db.prepare("PRAGMA table_info(task_runs)").all() as Array<{ name: string }>;
    expect(taskColumns.filter((column) => column.name === "permission_mode")).toHaveLength(1);
    expect(runColumns.filter((column) => column.name === "permission_mode")).toHaveLength(1);
  });
});
