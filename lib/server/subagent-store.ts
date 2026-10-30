import Database from "better-sqlite3";
import { dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { dataPath } from "./data-dir";
import {
  SUBAGENT_TERMINAL_STATUSES,
  isSubagentTerminalStatus,
  type SubagentTaskOrigin,
  type SubagentTaskStatus,
} from "../shared/types";

export type { SubagentTaskStatus, SubagentTaskOrigin };
export { isSubagentTerminalStatus };

const TERMINAL_SQL = SUBAGENT_TERMINAL_STATUSES.map((status) => `'${status}'`).join(", ");

export interface SubagentTask {
  taskId: string;
  parentSessionId: string;
  childSessionId: string | null;
  subagentName: string;
  description: string;
  prompt: string;
  status: SubagentTaskStatus;
  origin: SubagentTaskOrigin;
  result: string | null;
  error: string | null;
  requestId: string | null;
  configSnapshot: string | null;
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

const TASK_COLUMNS = [
  "task_id",
  "parent_session_id",
  "child_session_id",
  "subagent_name",
  "description",
  "prompt",
  "status",
  "result",
  "error",
  "origin",
  "request_id",
  "config_snapshot",
  "created_at",
  "started_at",
  "finished_at",
] as const;

const TASK_TABLE_DEFINITION = `
  CREATE TABLE IF NOT EXISTS subagent_tasks (
    task_id          TEXT NOT NULL,
    parent_session_id TEXT NOT NULL,
    child_session_id TEXT,
    subagent_name    TEXT NOT NULL,
    description      TEXT NOT NULL,
    prompt           TEXT NOT NULL,
    status           TEXT NOT NULL,
    result           TEXT,
    error            TEXT,
    origin           TEXT NOT NULL DEFAULT 'tool',
    request_id       TEXT,
    config_snapshot  TEXT,
    created_at       INTEGER NOT NULL,
    started_at       INTEGER,
    finished_at      INTEGER,
    -- A task id is a short counter per parent session ("0001", "0002", …), so
    -- two parents can hold the same id: a row is addressed by both.
    PRIMARY KEY (parent_session_id, task_id)
  );
`;

const TASK_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_subagent_tasks_parent_created
    ON subagent_tasks(parent_session_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_subagent_tasks_child
    ON subagent_tasks(child_session_id);
`;

const TASK_REQUEST_INDEX = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_subagent_tasks_request
    ON subagent_tasks(parent_session_id, request_id) WHERE request_id IS NOT NULL;
`;

const SCHEMA = `
  ${TASK_TABLE_DEFINITION}
  ${TASK_INDEXES}

  -- Task ids are short increasing numbers counted per parent session (see
  -- allocateSubagentTaskId); this table keeps each parent's high-water mark so
  -- an id is never handed out twice, even after its task row is pruned.
  CREATE TABLE IF NOT EXISTS subagent_task_seq (
    parent_session_id TEXT PRIMARY KEY,
    next_value        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subagent_profiles (
    name           TEXT PRIMARY KEY,
    description    TEXT NOT NULL,
    system_prompt  TEXT NOT NULL,
    inherit_system_prompt INTEGER NOT NULL DEFAULT 0,
    tools          TEXT NOT NULL,
    model_provider TEXT,
    model_id       TEXT,
    thinking_level TEXT NOT NULL,
    bot            TEXT NOT NULL,
    timeout_ms     INTEGER NOT NULL,
    builtin        INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
`;

function migrateTaskColumns(db: Database.Database): void {
  const columns = (db.prepare("PRAGMA table_info(subagent_tasks)").all() as Array<{ name: string }>)
    .map((column) => column.name);
  if (columns.includes("subagent_type") && !columns.includes("subagent_name")) {
    db.exec("ALTER TABLE subagent_tasks RENAME COLUMN subagent_type TO subagent_name");
  }
}

function migrateProfileColumns(db: Database.Database): void {
  const columns = (db.prepare("PRAGMA table_info(subagent_profiles)").all() as Array<{ name: string }>)
    .map((column) => column.name);
  if (!columns.includes("inherit_system_prompt")) {
    db.exec("ALTER TABLE subagent_profiles ADD COLUMN inherit_system_prompt INTEGER NOT NULL DEFAULT 0");
  }
}

function migrateTaskOriginColumn(db: Database.Database): void {
  const columns = (db.prepare("PRAGMA table_info(subagent_tasks)").all() as Array<{ name: string }>)
    .map((column) => column.name);
  if (!columns.includes("origin")) {
    db.exec("ALTER TABLE subagent_tasks ADD COLUMN origin TEXT NOT NULL DEFAULT 'tool'");
  }
}

function migrateTaskConfigColumn(db: Database.Database): void {
  const columns = (db.prepare("PRAGMA table_info(subagent_tasks)").all() as Array<{ name: string }>)
    .map((column) => column.name);
  if (!columns.includes("config_snapshot")) {
    db.exec("ALTER TABLE subagent_tasks ADD COLUMN config_snapshot TEXT");
  }
}

function migrateTaskRequestColumn(db: Database.Database): void {
  const columns = (db.prepare("PRAGMA table_info(subagent_tasks)").all() as Array<{ name: string }>)
    .map((column) => column.name);
  if (!columns.includes("request_id")) {
    db.exec("ALTER TABLE subagent_tasks ADD COLUMN request_id TEXT");
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subagent_tasks_request
      ON subagent_tasks(parent_session_id, request_id) WHERE request_id IS NOT NULL
  `);
}

function migrateTaskPrimaryKey(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(subagent_tasks)").all() as Array<{
    name: string;
    pk: number;
  }>;
  const keyColumns = columns.filter((column) => column.pk > 0).map((column) => column.name);
  if (keyColumns.length === 2 && keyColumns.includes("task_id") && keyColumns.includes("parent_session_id")) {
    return;
  }
  const names = TASK_COLUMNS.join(", ");
  const rebuild = db.transaction(() => {
    db.exec("DROP TABLE IF EXISTS subagent_tasks_v2");
    db.exec(TASK_TABLE_DEFINITION.replace("IF NOT EXISTS subagent_tasks", "subagent_tasks_v2"));
    db.exec(`INSERT INTO subagent_tasks_v2 (${names}) SELECT ${names} FROM subagent_tasks`);
    db.exec("DROP TABLE subagent_tasks");
    db.exec("ALTER TABLE subagent_tasks_v2 RENAME TO subagent_tasks");
    db.exec(TASK_INDEXES);
    db.exec(TASK_REQUEST_INDEX);
  });
  rebuild();
}

function migrateTaskSequenceTable(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(subagent_task_seq)").all() as Array<{ name: string }>;
  if (columns.length > 0 && !columns.some((column) => column.name === "parent_session_id")) {
    db.exec("DROP TABLE subagent_task_seq");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS subagent_task_seq (
      parent_session_id TEXT PRIMARY KEY,
      next_value        INTEGER NOT NULL
    )
  `);
}

export function hasSubagentStore(): boolean {
  return existsSync(resolveDbPath());
}

export function getSubagentDb(): Database.Database {
  if (globalThis.__piSubagentsDb) return globalThis.__piSubagentsDb;
  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrateTaskColumns(db);
  migrateTaskConfigColumn(db);
  migrateTaskRequestColumn(db);
  migrateTaskOriginColumn(db);
  migrateProfileColumns(db);
  migrateTaskSequenceTable(db);
  migrateTaskPrimaryKey(db);
  globalThis.__piSubagentsDb = db;
  return db;
}

function mapRow(row: Record<string, unknown>): SubagentTask {
  return {
    taskId: row.task_id as string,
    parentSessionId: row.parent_session_id as string,
    childSessionId: (row.child_session_id as string | null) ?? null,
    subagentName: row.subagent_name as string,
    description: row.description as string,
    prompt: row.prompt as string,
    status: row.status as SubagentTaskStatus,
    origin: (row.origin as SubagentTaskOrigin | null) ?? "tool",
    result: (row.result as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    requestId: (row.request_id as string | null) ?? null,
    configSnapshot: (row.config_snapshot as string | null) ?? null,
    createdAt: row.created_at as number,
    startedAt: (row.started_at as number | null) ?? null,
    finishedAt: (row.finished_at as number | null) ?? null,
  };
}

function allocateSubagentTaskId(db: Database.Database, parentSessionId: string): string {
  const allocate = db.transaction((parent: string): number => {
    const current = db.prepare(
      "SELECT next_value FROM subagent_task_seq WHERE parent_session_id = ?",
    ).get(parent) as { next_value: number } | undefined;
    if (current) {
      db.prepare("UPDATE subagent_task_seq SET next_value = ? WHERE parent_session_id = ?")
        .run(current.next_value + 1, parent);
      return current.next_value;
    }
    const legacy = db.prepare(
      "SELECT MAX(CAST(task_id AS INTEGER)) AS highest FROM subagent_tasks WHERE parent_session_id = ?",
    ).get(parent) as { highest: number | null };
    const next = Math.max(1, (legacy?.highest ?? 0) + 1);
    db.prepare("INSERT INTO subagent_task_seq (parent_session_id, next_value) VALUES (?, ?)")
      .run(parent, next + 1);
    return next;
  });
  return formatSubagentTaskId(allocate(parentSessionId));
}

function formatSubagentTaskId(value: number): string {
  return String(value).padStart(4, "0");
}

export function createSubagentTask(input: {
  taskId?: string;
  parentSessionId: string;
  subagentName: string;
  description: string;
  prompt: string;
  configSnapshot?: string | null;
  childSessionId?: string | null;
  requestId?: string | null;
  origin?: SubagentTaskOrigin;
}): SubagentTask {
  const now = Date.now();
  const db = getSubagentDb();
  const taskId = input.taskId ?? allocateSubagentTaskId(db, input.parentSessionId);
  db.prepare(`
    INSERT INTO subagent_tasks
      (task_id, parent_session_id, child_session_id, subagent_name, description, prompt, status, origin, request_id, config_snapshot, created_at)
    VALUES (@taskId, @parentSessionId, @childSessionId, @subagentName, @description, @prompt, @status, @origin, @requestId, @configSnapshot, @now)
  `).run({
    taskId,
    parentSessionId: input.parentSessionId,
    childSessionId: input.childSessionId ?? null,
    subagentName: input.subagentName,
    description: input.description,
    prompt: input.prompt,
    status: "queued" satisfies SubagentTaskStatus,
    origin: input.origin ?? "tool",
    requestId: input.requestId ?? null,
    configSnapshot: input.configSnapshot ?? null,
    now,
  });
  return getSubagentTask(input.parentSessionId, taskId)!;
}

export function markSubagentStatus(
  parentSessionId: string,
  taskId: string,
  status: "creating" | "stopping",
): void {
  getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET status = ?
    WHERE parent_session_id = ? AND task_id = ? AND status NOT IN (${TERMINAL_SQL})
  `).run(status, parentSessionId, taskId);
}

export function markSubagentRunning(parentSessionId: string, taskId: string, childSessionId: string): void {
  getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET child_session_id = ?, status = 'running', started_at = ?, error = NULL
    WHERE parent_session_id = ? AND task_id = ? AND status NOT IN (${TERMINAL_SQL})
  `).run(childSessionId, Date.now(), parentSessionId, taskId);
}

export function completeSubagentTask(parentSessionId: string, taskId: string, result: string): void {
  getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET status = 'completed', result = ?, error = NULL, finished_at = ?
    WHERE parent_session_id = ? AND task_id = ? AND status NOT IN (${TERMINAL_SQL})
  `).run(result, Date.now(), parentSessionId, taskId);
}

export function failSubagentTask(
  parentSessionId: string,
  taskId: string,
  error: string,
  status: "failed" | "cancelled" | "interrupted" = "failed",
): void {
  getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET status = ?, error = ?, finished_at = ?
    WHERE parent_session_id = ? AND task_id = ? AND status NOT IN (${TERMINAL_SQL})
  `).run(status, error, Date.now(), parentSessionId, taskId);
}

export function setSubagentTaskPartialOutput(parentSessionId: string, taskId: string, result: string): void {
  getSubagentDb().prepare("UPDATE subagent_tasks SET result = ? WHERE parent_session_id = ? AND task_id = ?")
    .run(result, parentSessionId, taskId);
}

export function setSubagentTaskConfigSnapshot(
  parentSessionId: string,
  taskId: string,
  configSnapshot: string,
): boolean {
  const result = getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET config_snapshot = ?
    WHERE parent_session_id = ? AND task_id = ? AND status NOT IN (${TERMINAL_SQL})
  `).run(configSnapshot, parentSessionId, taskId);
  return result.changes > 0;
}

export function reconcileInterruptedSubagentTasks(error = "Interrupted: the server restarted before this task finished"): number {
  const result = getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET status = 'interrupted',
        -- Keep a reason an earlier writer recorded; only a row without one gets
        -- the restart explanation.
        error = CASE WHEN error IS NULL OR error = '' THEN ? ELSE error END,
        finished_at = ?
    WHERE status NOT IN (${TERMINAL_SQL})
  `).run(error, Date.now());
  return result.changes;
}

export function listDescendantSubagentSessionIds(parentSessionId: string): string[] {
  if (!hasSubagentStore()) return [];
  const selectChildren = getSubagentDb().prepare(
    "SELECT DISTINCT child_session_id FROM subagent_tasks WHERE parent_session_id = ? AND child_session_id IS NOT NULL",
  );
  const seen = new Set<string>([parentSessionId]);
  const descendants: string[] = [];
  let frontier = [parentSessionId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const parent of frontier) {
      const rows = selectChildren.all(parent) as Array<{ child_session_id: string }>;
      for (const row of rows) {
        const child = row.child_session_id;
        if (seen.has(child)) continue;
        seen.add(child);
        descendants.push(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return descendants;
}

export function listSubagentChildSessionIds(): string[] {
  const rows = getSubagentDb().prepare(
    "SELECT child_session_id FROM subagent_tasks WHERE child_session_id IS NOT NULL",
  ).all() as Array<{ child_session_id: string | null }>;
  return rows.flatMap((row) => row.child_session_id ? [row.child_session_id] : []);
}

export function getSubagentTask(parentSessionId: string, taskId: string): SubagentTask | null {
  const row = getSubagentDb().prepare(
    "SELECT * FROM subagent_tasks WHERE parent_session_id = ? AND task_id = ?",
  ).get(parentSessionId, taskId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function findSubagentTask(taskId: string): SubagentTask | null {
  const rows = getSubagentDb().prepare(
    "SELECT * FROM subagent_tasks WHERE task_id = ? LIMIT 2",
  ).all(taskId) as Record<string, unknown>[];
  if (rows.length > 1) {
    throw new Error(`Task id "${taskId}" belongs to more than one parent session; pass the parent session id`);
  }
  return rows.length === 0 ? null : mapRow(rows[0]);
}

export function listSubagentTasks(parentSessionId: string): SubagentTask[] {
  const rows = getSubagentDb().prepare(
    "SELECT * FROM subagent_tasks WHERE parent_session_id = ? ORDER BY created_at DESC, rowid DESC",
  ).all(parentSessionId) as Record<string, unknown>[];
  return rows.map(mapRow);
}

export function getSubagentTaskByChildSessionId(childSessionId: string): SubagentTask | null {
  const row = getSubagentDb().prepare(
    "SELECT * FROM subagent_tasks WHERE child_session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
  ).get(childSessionId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function listSubagentTasksForChildSession(
  parentSessionId: string,
  childSessionId: string,
): SubagentTask[] {
  const rows = getSubagentDb().prepare(
    "SELECT * FROM subagent_tasks WHERE parent_session_id = ? AND child_session_id = ? ORDER BY created_at DESC, rowid DESC",
  ).all(parentSessionId, childSessionId) as Record<string, unknown>[];
  return rows.map(mapRow);
}

export function getSubagentTaskByRequestId(parentSessionId: string, requestId: string): SubagentTask | null {
  const row = getSubagentDb().prepare(
    "SELECT * FROM subagent_tasks WHERE parent_session_id = ? AND request_id = ? LIMIT 1",
  ).get(parentSessionId, requestId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function getSubagentSessionConfigSnapshot(
  parentSessionId: string,
  childSessionId: string,
): string | null {
  const row = getSubagentDb().prepare(
    "SELECT config_snapshot FROM subagent_tasks WHERE parent_session_id = ? AND child_session_id = ? AND config_snapshot IS NOT NULL ORDER BY created_at ASC, rowid ASC LIMIT 1",
  ).get(parentSessionId, childSessionId) as { config_snapshot: string | null } | undefined;
  return row?.config_snapshot ?? null;
}
