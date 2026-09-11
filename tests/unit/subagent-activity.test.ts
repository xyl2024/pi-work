import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import os from "node:os";
import { TEST_BASE_URL, ISOLATED_DATA_DIR } from "../config";
import { api, authedInit, uniqueId } from "./helpers";

/**
 * GET /api/subagents/[sessionId]/activity — live snapshot of a subagent child
 * session. Only session ids registered in the isolated instance's
 * subagents.db are readable; everything else must 404.
 */
describe("GET /api/subagents/[sessionId]/activity", () => {
  const randomChildSessionId = () => uniqueId("child") + "-0000-0000-0000-000000000000";

  const expandTilde = (p: string) => (p.startsWith("~") ? `${os.homedir()}${p.slice(1)}` : p);

  function seedSubagentTask(childSessionId: string): string {
    const dbPath = expandTilde(`${ISOLATED_DATA_DIR}/subagents.db`);
    mkdirSync(expandTilde(ISOLATED_DATA_DIR), { recursive: true });
    const db = new Database(dbPath);
    try {
      const taskId = `subagent:test-${uniqueId("t")}`;
      db.prepare(`
        INSERT INTO subagent_tasks
          (task_id, parent_session_id, child_session_id, subagent_type, description, prompt, status, created_at, started_at)
        VALUES (?, ?, ?, 'codebase_explorer', 'test task', 'test prompt', 'running', ?, ?)
      `).run(taskId, `parent-${uniqueId("p")}`, childSessionId, Date.now(), Date.now());
      return taskId;
    } finally {
      db.close();
    }
  }

  it("returns 404 for a session id that is not a registered subagent child", async () => {
    const { status, body } = await api(`/api/subagents/${randomChildSessionId()}/activity`);
    expect(status).toBe(404);
    expect(body.error).toBe("Not a subagent session");
  });

  it("returns task metadata and null stats for a registered child with no readable session", async () => {
    const childSessionId = randomChildSessionId();
    seedSubagentTask(childSessionId);
    const res = await fetch(`${TEST_BASE_URL}/api/subagents/${encodeURIComponent(childSessionId)}/activity`, await authedInit());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as {
      task: { status: string; startedAt: number | null; description: string } | null;
      stats: { assistantCount: number | null; readCount: number | null; model: string | null };
      activities: unknown[];
    };
    expect(body.task?.status).toBe("running");
    expect(body.task?.description).toBe("test task");
    expect(body.stats).toEqual({ assistantCount: null, readCount: null, model: null });
    expect(body.activities).toEqual([]);
  });
});
