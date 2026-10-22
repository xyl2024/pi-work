/**
 * SQLite-backed storage for token usage audit.
 *
 * Mirrors the singleton pattern in `lib/scheduler-db.ts`: `better-sqlite3` is
 * imported only here, the handle is cached on `globalThis` so Next.js dev-mode
 * HMR doesn't reopen it on every reload. Separate file from scheduler.db
 * because the audit log's lifecycle and access pattern
 * (continuous INSERT per pi `message_end`, no cascade) shouldn't entangle with
 * any other domain.
 *
 * File location: the data root's `token-audit.db` by default
 * (`~/.pi-work`, or `PI_WORK_DATA_DIR`), override with
 * `PI_WORK_TOKEN_AUDIT_DB` env var.
 */

import Database from "better-sqlite3";
import { dirname } from "path";
import { mkdirSync } from "fs";
import { createLogger } from "./logger";
import { dataPath } from "./data-dir";

const log = createLogger("token-audit-db");

declare global {
  var __piTokenAuditDb: Database.Database | undefined;
}

function resolveDbPath(): string {
  const override = process.env.PI_WORK_TOKEN_AUDIT_DB?.trim();
  if (override) return override;
  return dataPath("token-audit.db");
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS token_calls (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                INTEGER NOT NULL,
    session_id        TEXT    NOT NULL,
    message_id        TEXT    NOT NULL,
    source            TEXT    NOT NULL DEFAULT 'user',
    provider          TEXT    NOT NULL,
    model_id          TEXT    NOT NULL,
    api               TEXT,
    input_tokens      INTEGER NOT NULL DEFAULT 0,
    output_tokens     INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    cost_input  REAL NOT NULL DEFAULT 0,
    cost_output REAL NOT NULL DEFAULT 0,
    cost_read   REAL NOT NULL DEFAULT 0,
    cost_write  REAL NOT NULL DEFAULT 0,
    cost_total  REAL NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error       TEXT,
    -- message_id is msg.timestamp (ms since epoch). Effectively unique within
    -- a session; collisions only happen when pi replays the same message
    -- (compaction / SSE reconnect), which is exactly what UNIQUE catches.
    -- AssistantMessage has no id on the in-memory object — the JSONL entry id
    -- sits outside, not available to extensions.
    UNIQUE(session_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_token_calls_ts             ON token_calls(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_token_calls_session_ts    ON token_calls(session_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_token_calls_provider_model ON token_calls(provider, model_id);

  -- One row per logical model call: the timing/usage facts behind TTFT and
  -- the two TPS values. Kept beside token_calls rather than inside it so
  -- the existing billing rows (and the cost summary that queries them) keep
  -- their semantics: no billing column is forced to zero for a call whose
  -- usage is unknown, and a failure never looks like a zero-cost success.
  -- message_id is the joining key to the billing row when one exists.
  -- output_tokens is nullable on purpose: NULL = not reported, 0 = a
  -- provider-reported zero. TPS is derived at read time, never stored.
  CREATE TABLE IF NOT EXISTS model_calls (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id                TEXT    NOT NULL UNIQUE,
    started_at             INTEGER NOT NULL,
    session_id             TEXT,
    message_id             TEXT,
    source                 TEXT    NOT NULL DEFAULT 'unknown',
    purpose                TEXT    NOT NULL DEFAULT 'unknown',
    provider               TEXT    NOT NULL DEFAULT 'unknown',
    model_id               TEXT    NOT NULL DEFAULT 'unknown',
    api                    TEXT,
    status                 TEXT    NOT NULL DEFAULT 'unknown',
    ttft_ms                INTEGER,
    generation_duration_ms INTEGER,
    duration_ms            INTEGER,
    output_tokens          INTEGER,
    error                  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_model_calls_started_at ON model_calls(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_model_calls_session    ON model_calls(session_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_model_calls_message    ON model_calls(session_id, message_id);
`;

export function getTokenAuditDb(): Database.Database {
  if (globalThis.__piTokenAuditDb) return globalThis.__piTokenAuditDb;

  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  globalThis.__piTokenAuditDb = db;
  log.info("token-audit db opened", { dbPath });
  return db;
}
