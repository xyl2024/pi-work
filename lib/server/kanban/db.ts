/**
 * SQLite-backed storage for Kanban tasks.
 *
 * Follows the scheduler db.ts pattern: better-sqlite3 imported only here, the
 * handle cached on globalThis so Next.js dev HMR doesn't reopen it, and an
 * env override `PI_WORK_KANBAN_DB` (default `~/.pi-work/kanban.db`).
 *
 * Kanban is deliberately simpler than the scheduler: there is no separate
 * `task_runs` table — a task IS the unit of work. Starting a run flips an
 * individual task from `backlog` to `in_progress`, records its session id,
 * and when the run finishes it moves to `review_test`. This keeps the CRUD
 * and status transitions a single-row concern.
 */

import Database from "better-sqlite3";
import { dirname } from "path";
import { mkdirSync } from "fs";
import { dataPath } from "../data-dir";

declare global {
  var __piKanbanDb: Database.Database | undefined;
}

function resolveDbPath(): string {
  const override = process.env.PI_WORK_KANBAN_DB?.trim();
  if (override) return override;
  return dataPath("kanban.db");
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS kanban_tasks (
    id             TEXT PRIMARY KEY,
    task_name      TEXT,
    prompt         TEXT NOT NULL,
    provider       TEXT,
    model_id       TEXT,
    thinking_level TEXT,
    cwd            TEXT NOT NULL,
    tool_names     TEXT,
    status         TEXT NOT NULL DEFAULT 'backlog',
    error          TEXT,
    created_at     INTEGER NOT NULL,
    started_at     INTEGER,
    ended_at       INTEGER,
    session_id     TEXT,
    result_summary TEXT,
    sort_order     INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_kanban_tasks_status
    ON kanban_tasks(status, sort_order);
`;

/**
 * Additive migrations — each new column needs an explicit guarded
 * `ALTER TABLE ... ADD COLUMN` here (idempotent, safe on every open).
 */
function runMigrations(db: Database.Database): void {
  const cols = db
    .prepare("PRAGMA table_info(kanban_tasks)")
    .all() as Array<{ name: string }>;
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has("sort_order")) {
    db.exec("ALTER TABLE kanban_tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }
  if (!has("task_name")) {
    db.exec("ALTER TABLE kanban_tasks ADD COLUMN task_name TEXT");
    // Backfill a sensible name for pre-existing rows: the first non-empty line
    // of the prompt, trimmed to 60 chars.
    db.exec(`
      UPDATE kanban_tasks
      SET task_name = substr(trim(substr(prompt, 1, instr(prompt || char(10), char(10)) - 1)), 1, 60)
      WHERE task_name IS NULL OR task_name = ''
    `);
  }
}

export function getKanbanDb(): Database.Database {
  if (globalThis.__piKanbanDb) return globalThis.__piKanbanDb;

  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  runMigrations(db);

  globalThis.__piKanbanDb = db;
  return db;
}