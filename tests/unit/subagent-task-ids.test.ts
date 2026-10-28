import { afterAll, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Task ids: a short counter (`0001`, `0002`, …) counted per parent session,
 * never reused once handed out, and unique per parent only — so a task row is
 * addressed by `(parentSessionId, taskId)`.
 *
 * The suite also covers the store migration that re-keys an old database, where
 * ids came from a single global counter and `task_id` alone was the primary key.
 */

let dir: string;

function resetStoreGlobals(): void {
  delete (globalThis as { __piSubagentsDb?: unknown }).__piSubagentsDb;
}

function resetStore(path = join(dir, `store-${Math.random().toString(36).slice(2)}.db`)): void {
  resetStoreGlobals();
  process.env.PI_WORK_SUBAGENTS_DB = path;
}

beforeEach(() => {
  if (!dir) dir = mkdtempSync(join(tmpdir(), "pi-work-subagent-ids-"));
  resetStore();
});

afterAll(() => {
  resetStoreGlobals();
  delete process.env.PI_WORK_SUBAGENTS_DB;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const seed = {
  subagentName: "codebase_explorer",
  description: "explore",
  prompt: "look around",
};

describe("per-session task ids", () => {
  it("counts per parent session, zero padded to four digits", async () => {
    const { createSubagentTask } = await import("@/lib/server/subagent-store");

    expect(createSubagentTask({ ...seed, parentSessionId: "parent-a" }).taskId).toBe("0001");
    expect(createSubagentTask({ ...seed, parentSessionId: "parent-a" }).taskId).toBe("0002");
    // The counter belongs to its parent: another session starts at 0001 again.
    expect(createSubagentTask({ ...seed, parentSessionId: "parent-b" }).taskId).toBe("0001");
    expect(createSubagentTask({ ...seed, parentSessionId: "parent-a" }).taskId).toBe("0003");
  });

  it("looks a task up by its parent, and refuses to guess on a bare id", async () => {
    const { createSubagentTask, findSubagentTask, getSubagentTask } = await import("@/lib/server/subagent-store");
    createSubagentTask({ ...seed, parentSessionId: "parent-a" });
    createSubagentTask({ ...seed, parentSessionId: "parent-b" });

    expect(getSubagentTask("parent-a", "0001")?.parentSessionId).toBe("parent-a");
    expect(getSubagentTask("parent-b", "0001")?.parentSessionId).toBe("parent-b");
    expect(getSubagentTask("parent-c", "0001")).toBeNull();
    // Two parents hold "0001"; resolving it alone must not silently pick one.
    expect(() => findSubagentTask("0001")).toThrow(/more than one parent session/);
  });

  it("never reuses an id, even after the row is gone", async () => {
    const { createSubagentTask, getSubagentDb, listSubagentTasks } = await import("@/lib/server/subagent-store");
    const first = createSubagentTask({ ...seed, parentSessionId: "parent-a" });
    createSubagentTask({ ...seed, parentSessionId: "parent-a" });

    getSubagentDb().prepare("DELETE FROM subagent_tasks WHERE parent_session_id = ? AND task_id = ?")
      .run("parent-a", first.taskId);

    expect(listSubagentTasks("parent-a")).toHaveLength(1);
    expect(createSubagentTask({ ...seed, parentSessionId: "parent-a" }).taskId).toBe("0003");
  });
});

describe("task id migration", () => {
  it("re-keys an old table on (parent, task) and continues after the last legacy id", async () => {
    const legacyPath = join(dir, "legacy-ids.db");
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE subagent_tasks (
        task_id           TEXT PRIMARY KEY,
        parent_session_id TEXT NOT NULL,
        child_session_id  TEXT,
        subagent_name     TEXT NOT NULL,
        description       TEXT NOT NULL,
        prompt            TEXT NOT NULL,
        status            TEXT NOT NULL,
        result            TEXT,
        error             TEXT,
        created_at        INTEGER NOT NULL,
        started_at        INTEGER,
        finished_at       INTEGER
      )
    `);
    const insert = legacy.prepare(`
      INSERT INTO subagent_tasks
        (task_id, parent_session_id, subagent_name, description, prompt, status, created_at)
      VALUES (?, ?, 'codebase_explorer', 'd', 'p', 'completed', 1)
    `);
    // One global counter: ids 1..3, all owned by the same parent.
    insert.run("1", "parent-legacy");
    insert.run("2", "parent-legacy");
    insert.run("3", "parent-legacy");
    legacy.close();

    resetStore(legacyPath);
    const { createSubagentTask, getSubagentDb, getSubagentTask, listSubagentTasks } =
      await import("@/lib/server/subagent-store");

    // Legacy rows survive, still readable by (parent, id).
    expect(listSubagentTasks("parent-legacy")).toHaveLength(3);
    expect(getSubagentTask("parent-legacy", "2")).toMatchObject({ status: "completed" });

    // The key is now the pair, so the id may repeat across parents…
    const key = (getSubagentDb().prepare("PRAGMA table_info(subagent_tasks)").all() as Array<{
      name: string;
      pk: number;
    }>).filter((column) => column.pk > 0).map((column) => column.name);
    expect(key.sort()).toEqual(["parent_session_id", "task_id"]);

    // …while this parent keeps counting after the highest id it already holds.
    expect(createSubagentTask({ ...seed, parentSessionId: "parent-legacy" }).taskId).toBe("0004");
    expect(createSubagentTask({ ...seed, parentSessionId: "parent-fresh" }).taskId).toBe("0001");
  });
});
