/**
 * SQLite-backed storage for workflow runs.
 *
 * Fully separate from the scheduler DB — workflows and scheduled tasks are
 * independent systems. Mirrors the scheduler db singleton pattern: clipboard-
 * cached on `globalThis` so Next.js dev-mode HMR doesn't reopen it, with a
 * separate file (`~/.pi-work/workflow.db`, `PI_WORK_WORKFLOW_DB` override)
 * and its own idempotent additive migrations.
 */

import Database from "better-sqlite3";
import { dirname } from "path";
import { mkdirSync } from "fs";
import { createLogger } from "../logger";
import { dataPath } from "../data-dir";

const log = createLogger("workflow-db");

declare global {
  var __piWorkflowDb: Database.Database | undefined;
  var __piWorkflowMigrated: boolean | undefined;
}

function resolveDbPath(): string {
  const override = process.env.PI_WORK_WORKFLOW_DB?.trim();
  if (override) return override;
  return dataPath("workflow.db");
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS workflows (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    trigger_type  TEXT NOT NULL,        -- 'manual' | 'cron'
    cron          TEXT,
    timezone      TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    cwd           TEXT NOT NULL,
    notification  TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    next_run_at   INTEGER,
    last_run_at   INTEGER
  );

  CREATE TABLE IF NOT EXISTS workflow_nodes (
    id             TEXT PRIMARY KEY,
    workflow_id    TEXT NOT NULL,
    name           TEXT NOT NULL,
    prompt         TEXT NOT NULL,
    cwd            TEXT,
    provider       TEXT,
    model_id       TEXT,
    thinking_level TEXT,
    tool_names     TEXT,
    max_lifetime_ms INTEGER,
    depends_on     TEXT NOT NULL DEFAULT '[]',
    failure_policy TEXT NOT NULL DEFAULT 'fail',
    max_attempts   INTEGER NOT NULL DEFAULT 1,
    position       INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id             TEXT PRIMARY KEY,
    workflow_id    TEXT NOT NULL,
    trigger        TEXT NOT NULL,       -- 'manual' | 'cron'
    trigger_input  TEXT,
    status         TEXT NOT NULL DEFAULT 'running',
    error          TEXT,
    reply_text     TEXT,
    started_at     INTEGER NOT NULL,
    ended_at       INTEGER,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workflow_run_nodes (
    id           TEXT PRIMARY KEY,
    run_id       TEXT NOT NULL,
    node_id      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    attempts     INTEGER NOT NULL DEFAULT 0,
    render_input TEXT,
    reply_text   TEXT,
    error        TEXT,
    session_id   TEXT,
    started_at   INTEGER,
    ended_at     INTEGER,
    duration_ms  INTEGER,
    FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow
    ON workflow_nodes(workflow_id, position);
  CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_started
    ON workflow_runs(workflow_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_workflow_run_nodes_run
    ON workflow_run_nodes(run_id);
  CREATE INDEX IF NOT EXISTS idx_workflows_enabled_next
    ON workflows(enabled, next_run_at);
`;

/** Additive, idempotent migrations for DBs seeded before a column shipped. */
function runMigrations(db: Database.Database): void {
  const wfCols = db.prepare("PRAGMA table_info(workflows)").all() as Array<{ name: string }>;
  const hasDescription = wfCols.some((c) => c.name === "description");
  if (!hasDescription) {
    db.exec("ALTER TABLE workflows ADD COLUMN description TEXT NOT NULL DEFAULT ''");
    log.info("migration: added workflows.description column");
  }
  const nodeCols = db.prepare("PRAGMA table_info(workflow_nodes)").all() as Array<{ name: string }>;
  const hasFailurePolicy = nodeCols.some((c) => c.name === "failure_policy");
  if (!hasFailurePolicy) {
    db.exec("ALTER TABLE workflow_nodes ADD COLUMN failure_policy TEXT NOT NULL DEFAULT 'fail'");
    db.exec("ALTER TABLE workflow_nodes ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 1");
    log.info("migration: added workflow_nodes failure_policy/max_attempts columns");
  }
  const hasX = nodeCols.some((c) => c.name === "x");
  if (!hasX) {
    db.exec("ALTER TABLE workflow_nodes ADD COLUMN x INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE workflow_nodes ADD COLUMN y INTEGER NOT NULL DEFAULT 0");
    log.info("migration: added workflow_nodes x/y canvas columns");
  }
  const hasKind = nodeCols.some((c) => c.name === "kind");
  if (!hasKind) {
    db.exec("ALTER TABLE workflow_nodes ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent'");
    db.exec("ALTER TABLE workflow_nodes ADD COLUMN params TEXT NOT NULL DEFAULT '{}'");
    db.exec("ALTER TABLE workflow_nodes ADD COLUMN inputs TEXT NOT NULL DEFAULT '[]'");
    log.info("migration: added workflow_nodes kind/params/inputs columns");
  }
}

export function getWorkflowDb(): Database.Database {
  if (globalThis.__piWorkflowDb) return globalThis.__piWorkflowDb;

  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  if (!globalThis.__piWorkflowMigrated) {
    globalThis.__piWorkflowMigrated = true;
    runMigrations(db);
  }

  globalThis.__piWorkflowDb = db;
  return db;
}