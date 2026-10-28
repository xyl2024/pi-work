import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { dataPath } from "./data-dir";
import {
  SUBAGENT_TERMINAL_STATUSES,
  isSubagentTerminalStatus,
  type SubagentTaskStatus,
} from "../shared/types";

export type { SubagentTaskStatus };
export { isSubagentTerminalStatus };

/** The same rule as SQL, for the guarded UPDATEs below. */
const TERMINAL_SQL = SUBAGENT_TERMINAL_STATUSES.map((status) => `'${status}'`).join(", ");

export interface SubagentTask {
  taskId: string;
  parentSessionId: string;
  childSessionId: string | null;
  /** Name of the configured subagent profile this task ran. */
  subagentName: string;
  description: string;
  prompt: string;
  status: SubagentTaskStatus;
  result: string | null;
  error: string | null;
  /**
   * Optional caller-supplied request id used to dedupe a retried spawn /
   * continue. Unique per parent session; null for tasks created before it
   * existed or without one.
   */
  requestId: string | null;
  /**
   * JSON config resolved when the task was created (profile, model, thinking
   * level, tools, system prompt, runtime limit). Reused when the child session
   * continues, so editing the profile never changes an existing child.
   * Null for rows written before snapshots existed.
   */
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

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS subagent_tasks (
    task_id          TEXT PRIMARY KEY,
    parent_session_id TEXT NOT NULL,
    child_session_id TEXT,
    subagent_name    TEXT NOT NULL,
    description      TEXT NOT NULL,
    prompt           TEXT NOT NULL,
    status           TEXT NOT NULL,
    result           TEXT,
    error            TEXT,
    request_id       TEXT,
    config_snapshot  TEXT,
    created_at       INTEGER NOT NULL,
    started_at       INTEGER,
    finished_at      INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_subagent_tasks_parent_created
    ON subagent_tasks(parent_session_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_subagent_tasks_child
    ON subagent_tasks(child_session_id);

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

/**
 * Rename `subagent_tasks.subagent_type` to `subagent_name` on databases created
 * before profiles became user-defined. Idempotent: the column is only renamed
 * while the old name is present and the new one is not. Old rows keep their
 * values, which are now profile names (`codebase_explorer` / `code_reviewer`
 * are exactly the names of the seeded built-ins).
 */
function migrateTaskColumns(db: Database.Database): void {
  const columns = (db.prepare("PRAGMA table_info(subagent_tasks)").all() as Array<{ name: string }>)
    .map((column) => column.name);
  if (columns.includes("subagent_type") && !columns.includes("subagent_name")) {
    db.exec("ALTER TABLE subagent_tasks RENAME COLUMN subagent_type TO subagent_name");
  }
}

/**
 * Add `inherit_system_prompt` to profile tables created before the flag
 * existed. The NOT NULL column can be added by ALTER because it has a default;
 * the existing prompts stay in place as the fallback text.
 */
function migrateProfileColumns(db: Database.Database): void {
  const columns = (db.prepare("PRAGMA table_info(subagent_profiles)").all() as Array<{ name: string }>)
    .map((column) => column.name);
  if (!columns.includes("inherit_system_prompt")) {
    db.exec("ALTER TABLE subagent_profiles ADD COLUMN inherit_system_prompt INTEGER NOT NULL DEFAULT 0");
  }
}

/**
 * Add `config_snapshot` to task tables created before the column existed.
 * Idempotent: only added while absent. Legacy rows keep NULL, which readers
 * treat as "no snapshot to reuse" rather than inventing today's profile.
 */
function migrateTaskConfigColumn(db: Database.Database): void {
  const columns = (db.prepare("PRAGMA table_info(subagent_tasks)").all() as Array<{ name: string }>)
    .map((column) => column.name);
  if (!columns.includes("config_snapshot")) {
    db.exec("ALTER TABLE subagent_tasks ADD COLUMN config_snapshot TEXT");
  }
}

/**
 * Add `request_id` to task tables created before dedupe existed, and make the
 * per-parent uniqueness cheap to enforce. Idempotent: the column/index are only
 * created while absent, and legacy rows keep NULL (never deduped).
 */
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
  migrateProfileColumns(db);
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
    result: (row.result as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    requestId: (row.request_id as string | null) ?? null,
    configSnapshot: (row.config_snapshot as string | null) ?? null,
    createdAt: row.created_at as number,
    startedAt: (row.started_at as number | null) ?? null,
    finishedAt: (row.finished_at as number | null) ?? null,
  };
}

export function createSubagentTask(input: {
  taskId: string;
  parentSessionId: string;
  subagentName: string;
  description: string;
  prompt: string;
  /** JSON config snapshot; absent for callers that have none to record. */
  configSnapshot?: string | null;
  /** Continue: the existing child session this task runs in. */
  childSessionId?: string | null;
  /** Optional dedupe key, unique per parent session. */
  requestId?: string | null;
}): SubagentTask {
  const now = Date.now();
  getSubagentDb().prepare(`
    INSERT INTO subagent_tasks
      (task_id, parent_session_id, child_session_id, subagent_name, description, prompt, status, request_id, config_snapshot, created_at)
    VALUES (@taskId, @parentSessionId, @childSessionId, @subagentName, @description, @prompt, @status, @requestId, @configSnapshot, @now)
  `).run({
    taskId: input.taskId,
    parentSessionId: input.parentSessionId,
    childSessionId: input.childSessionId ?? null,
    subagentName: input.subagentName,
    description: input.description,
    prompt: input.prompt,
    // The id exists before the child session does; a queued task is a real,
    // addressable task whose slot has not been granted yet.
    status: "queued" satisfies SubagentTaskStatus,
    requestId: input.requestId ?? null,
    configSnapshot: input.configSnapshot ?? null,
    now,
  });
  return getSubagentTask(input.taskId)!;
}

/** Move a task to a non-terminal status (`creating`, `stopping`, …). */
export function markSubagentStatus(taskId: string, status: "creating" | "stopping"): void {
  getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET status = ?
    WHERE task_id = ? AND status NOT IN (${TERMINAL_SQL})
  `).run(status, taskId);
}

export function markSubagentRunning(taskId: string, childSessionId: string): void {
  getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET child_session_id = ?, status = 'running', started_at = ?, error = NULL
    WHERE task_id = ? AND status NOT IN (${TERMINAL_SQL})
  `).run(childSessionId, Date.now(), taskId);
}

export function completeSubagentTask(taskId: string, result: string): void {
  getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET status = 'completed', result = ?, error = NULL, finished_at = ?
    WHERE task_id = ? AND status NOT IN (${TERMINAL_SQL})
  `).run(result, Date.now(), taskId);
}

export function failSubagentTask(
  taskId: string,
  error: string,
  status: "failed" | "cancelled" | "interrupted" = "failed",
): void {
  getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET status = ?, error = ?, finished_at = ?
    WHERE task_id = ? AND status NOT IN (${TERMINAL_SQL})
  `).run(status, error, Date.now(), taskId);
}

/**
 * Attach the last partial output an abnormal stop produced. The row's `error`
 * keeps the bare reason; this is the text the caller can also read. Deliberately
 * not status-guarded: the manager calls it immediately after the terminal
 * `failSubagentTask` write for the same task, where no other writer can be in
 * between.
 */
export function setSubagentTaskPartialOutput(taskId: string, result: string): void {
  getSubagentDb().prepare("UPDATE subagent_tasks SET result = ? WHERE task_id = ?")
    .run(result, taskId);
}

/**
 * Mark every task that never reached a terminal state as interrupted. Called
 * once when the task manager starts: a restarted process cannot confirm the
 * child turns are still running, so it reports the truth instead of leaving a
 * stale `running` row or replaying the input.
 */
export function reconcileInterruptedSubagentTasks(error = "Interrupted: the server restarted before this task finished"): number {
  const result = getSubagentDb().prepare(`
    UPDATE subagent_tasks
    SET status = 'interrupted', error = ?, finished_at = ?
    WHERE status NOT IN (${TERMINAL_SQL})
  `).run(error, Date.now());
  return result.changes;
}

export function listSubagentChildSessionIds(): string[] {
  const rows = getSubagentDb().prepare(
    "SELECT child_session_id FROM subagent_tasks WHERE child_session_id IS NOT NULL",
  ).all() as Array<{ child_session_id: string | null }>;
  return rows.flatMap((row) => row.child_session_id ? [row.child_session_id] : []);
}

export function getSubagentTask(taskId: string): SubagentTask | null {
  const row = getSubagentDb().prepare(
    "SELECT * FROM subagent_tasks WHERE task_id = ?",
  ).get(taskId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function listSubagentTasks(parentSessionId: string): SubagentTask[] {
  const rows = getSubagentDb().prepare(
    // rowid breaks created_at ties: several tasks can be created in the same
    // millisecond, and "newest first" must still match insertion order.
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

/** Every task of one direct child session of `parentSessionId`, newest first. */
export function listSubagentTasksForChildSession(
  parentSessionId: string,
  childSessionId: string,
): SubagentTask[] {
  const rows = getSubagentDb().prepare(
    "SELECT * FROM subagent_tasks WHERE parent_session_id = ? AND child_session_id = ? ORDER BY created_at DESC, rowid DESC",
  ).all(parentSessionId, childSessionId) as Record<string, unknown>[];
  return rows.map(mapRow);
}

/** The dedupe record of one parent's request id, or null. */
export function getSubagentTaskByRequestId(parentSessionId: string, requestId: string): SubagentTask | null {
  const row = getSubagentDb().prepare(
    "SELECT * FROM subagent_tasks WHERE parent_session_id = ? AND request_id = ? LIMIT 1",
  ).get(parentSessionId, requestId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

/**
 * The configuration frozen when a child session was created: the snapshot of
 * its oldest task. Later tasks of the same session reuse it, so editing or
 * deleting the profile never reconfigures a running child. Null when the
 * session predates snapshots (the caller then fails loudly instead of applying
 * today's profile).
 */
export function getSubagentSessionConfigSnapshot(
  parentSessionId: string,
  childSessionId: string,
): string | null {
  const row = getSubagentDb().prepare(
    "SELECT config_snapshot FROM subagent_tasks WHERE parent_session_id = ? AND child_session_id = ? AND config_snapshot IS NOT NULL ORDER BY created_at ASC, rowid ASC LIMIT 1",
  ).get(parentSessionId, childSessionId) as { config_snapshot: string | null } | undefined;
  return row?.config_snapshot ?? null;
}
