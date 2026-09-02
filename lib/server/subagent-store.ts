import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { dataPath } from "./data-dir";

export type SubagentTaskStatus = "creating" | "running" | "completed" | "failed" | "cancelled";

export interface SubagentTask {
  taskId: string;
  parentSessionId: string;
  childSessionId: string | null;
  subagentType: "codebase_explorer";
  description: string;
  prompt: string;
  status: SubagentTaskStatus;
  result: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

declare global {
  var __piSubagentsDb: Database.Database | undefined;
}

function resolveDbPath(): string {
  return process.env.PI_WORK_SUBAGENTS_DB?.trim() || dataPath("subagents.db");
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS subagent_tasks (
    task_id          TEXT PRIMARY KEY,
    parent_session_id TEXT NOT NULL,
    child_session_id TEXT,
    subagent_type    TEXT NOT NULL,
    description      TEXT NOT NULL,
    prompt           TEXT NOT NULL,
    status           TEXT NOT NULL,
    result           TEXT,
    error            TEXT,
    created_at       INTEGER NOT NULL,
    started_at       INTEGER,
    finished_at      INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_subagent_tasks_parent_created
    ON subagent_tasks(parent_session_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_subagent_tasks_child
    ON subagent_tasks(child_session_id);
`;

export function getSubagentDb(): Database.Database {
  if (globalThis.__piSubagentsDb) return globalThis.__piSubagentsDb;
  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  globalThis.__piSubagentsDb = db;
  return db;
}

function mapRow(row: Record<string, unknown>): SubagentTask {
  return {
    taskId: row.task_id as string,
    parentSessionId: row.parent_session_id as string,
    childSessionId: (row.child_session_id as string | null) ?? null,
    subagentType: row.subagent_type as "codebase_explorer",
    description: row.description as string,
    prompt: row.prompt as string,
    status: row.status as SubagentTaskStatus,
    result: (row.result as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    createdAt: row.created_at as number,
    startedAt: (row.started_at as number | null) ?? null,
    finishedAt: (row.finished_at as number | null) ?? null,
  };
}

export function createSubagentTask(input: {
  taskId: string;
  parentSessionId: string;
  subagentType: "codebase_explorer";
  description: string;
  prompt: string;
}): SubagentTask {
  const now = Date.now();
  getSubagentDb().prepare(`
    INSERT INTO subagent_tasks
      (task_id, parent_session_id, subagent_type, description, prompt, status, created_at)
    VALUES (@taskId, @parentSessionId, @subagentType, @description, @prompt, 'creating', @now)
  `).run({ ...input, now });
  return getSubagentTask(input.taskId)!;
}

export function markSubagentRunning(taskId: string, childSessionId: string): void {
  getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET child_session_id = ?, status = 'running', started_at = ?, error = NULL
    WHERE task_id = ?
  `).run(childSessionId, Date.now(), taskId);
}

export function completeSubagentTask(taskId: string, result: string): void {
  getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET status = 'completed', result = ?, error = NULL, finished_at = ?
    WHERE task_id = ?
  `).run(result, Date.now(), taskId);
}

export function failSubagentTask(taskId: string, error: string, status: "failed" | "cancelled" = "failed"): void {
  getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET status = ?, error = ?, finished_at = ?
    WHERE task_id = ?
  `).run(status, error, Date.now(), taskId);
}

export function getSubagentTask(taskId: string): SubagentTask | null {
  const row = getSubagentDb().prepare(
    "SELECT * FROM subagent_tasks WHERE task_id = ?",
  ).get(taskId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function listSubagentTasks(parentSessionId: string): SubagentTask[] {
  const rows = getSubagentDb().prepare(
    "SELECT * FROM subagent_tasks WHERE parent_session_id = ? ORDER BY created_at DESC",
  ).all(parentSessionId) as Record<string, unknown>[];
  return rows.map(mapRow);
}
