/**
 * SQLite-backed storage for the LLM API call audit log (`provider_calls`).
 *
 * Mirrors the singleton pattern in `lib/token-audit-db.ts`: `better-sqlite3`
 * is imported only here, the handle is cached on `globalThis` so Next.js
 * dev-mode HMR doesn't reopen it on every reload. Separate file from
 * token-audit.db because rows here carry full request/response bodies (large,
 * WAL-heavy) and have a completely different lifecycle — an append-only
 * detail log, not an aggregate stats table.
 *
 * File location: `~/.pi-work/llm-audit.db` by default, override with
 * `PI_WORK_LLM_AUDIT_DB` env var.
 */

import Database from "better-sqlite3";
import { dirname, join } from "path";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { createLogger } from "./logger";
import type {
  AuditedSession,
  LlmAuditSource,
  ListProviderCallsParams,
  ProviderCall,
  ProviderCallInsert,
} from "./llm-audit-types";

const log = createLogger("llm-audit-db");

declare global {
  var __piLlmAuditDb: Database.Database | undefined;
}

function resolveDbPath(): string {
  const override = process.env.PI_WORK_LLM_AUDIT_DB?.trim();
  if (override) return override;
  return join(homedir(), ".pi-work", "llm-audit.db");
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS provider_calls (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                INTEGER NOT NULL,
    session_id        TEXT,
    source            TEXT,
    provider          TEXT,
    model_id          TEXT,
    api               TEXT,
    url               TEXT    NOT NULL,
    attempt           INTEGER NOT NULL DEFAULT 1,
    request_body      TEXT,
    request_headers   TEXT,
    status            INTEGER,
    response_headers  TEXT,
    response_body     TEXT,
    error             TEXT,
    duration_ms       INTEGER,
    cwd               TEXT,
    session_name      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_provider_calls_ts       ON provider_calls(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_provider_calls_session  ON provider_calls(session_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_provider_calls_status   ON provider_calls(status);
`;

/** Backfill columns added after the initial schema for pre-existing DBs. */
const MIGRATIONS: string[] = [
  "ALTER TABLE provider_calls ADD COLUMN cwd TEXT",
  "ALTER TABLE provider_calls ADD COLUMN session_name TEXT",
];

/**
 * Idempotent schema ensure: create table if missing and backfill columns that
 * were added after the initial release. Runs on EVERY call to getLlmAuditDb —
 * the handle is cached on `globalThis` (survives Next.js HMR), so a cached
 * pre-migration handle must not skip the backfill.
 */
function ensureSchema(db: Database.Database): void {
  db.exec(SCHEMA);
  const existingCols = new Set(
    (db.prepare("PRAGMA table_info(provider_calls)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const migration of MIGRATIONS) {
    const colName = migration.match(/ADD COLUMN (\w+)/)?.[1];
    if (colName && !existingCols.has(colName)) {
      try {
        db.exec(migration);
      } catch (e) {
        log.warn("llm-audit migration failed", { migration, error: String(e) });
      }
    }
  }
}

export function getLlmAuditDb(): Database.Database {
  if (globalThis.__piLlmAuditDb) {
    // Handle may predate the cwd/session_name columns (HMR across edits) —
    // re-run the idempotent migration against the live handle.
    ensureSchema(globalThis.__piLlmAuditDb);
    return globalThis.__piLlmAuditDb;
  }

  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  ensureSchema(db);

  globalThis.__piLlmAuditDb = db;
  log.info("llm-audit db opened", { dbPath });
  return db;
}

interface Row {
  id: number;
  ts: number;
  session_id: string | null;
  source: string | null;
  cwd: string | null;
  session_name: string | null;
  provider: string | null;
  model_id: string | null;
  api: string | null;
  url: string;
  attempt: number;
  request_body: string | null;
  request_headers: string | null;
  status: number | null;
  response_headers: string | null;
  response_body: string | null;
  error: string | null;
  duration_ms: number | null;
}

function rowToCall(r: Row): ProviderCall {
  return {
    id: r.id,
    ts: r.ts,
    sessionId: r.session_id,
    source: normalizeSource(r.source),
    cwd: r.cwd,
    sessionName: r.session_name,
    provider: r.provider,
    modelId: r.model_id,
    api: r.api,
    url: r.url,
    attempt: r.attempt,
    requestBody: r.request_body,
    requestHeaders: r.request_headers,
    status: r.status,
    responseHeaders: r.response_headers,
    responseBody: r.response_body,
    error: r.error,
    durationMs: r.duration_ms ?? 0,
  };
}

function normalizeSource(s: string | null): LlmAuditSource {
  if (s === "user" || s === "scheduled" || s === "direct") return s;
  return "unknown";
}

const INSERT_SQL = `
  INSERT INTO provider_calls
    (ts, session_id, source, provider, model_id, api, url, attempt,
     request_body, request_headers, status, response_headers, response_body,
     error, duration_ms, cwd, session_name)
  VALUES
    (@ts, @sessionId, @source, @provider, @modelId, @api, @url, @attempt,
     @requestBody, @requestHeaders, @status, @responseHeaders, @responseBody,
     @error, @durationMs, @cwd, @sessionName)
`;

export function insertProviderCall(input: ProviderCallInsert): number {
  const db = getLlmAuditDb();
  const res = db.prepare(INSERT_SQL).run(input);
  return Number(res.lastInsertRowid);
}

export function listProviderCalls(p: ListProviderCallsParams): { rows: ProviderCall[]; total: number } {
  const db = getLlmAuditDb();
  const whereParts: string[] = [];
  const args: unknown[] = [];
  if (p.sessionId) {
    whereParts.push("session_id = ?");
    args.push(p.sessionId);
  }
  if (p.status === "ok") {
    whereParts.push("status >= 200 AND status < 300");
  } else if (p.status === "error") {
    whereParts.push("(status IS NULL OR status < 200 OR status >= 300)");
  }
  if (p.modelId) {
    whereParts.push("model_id = ?");
    args.push(p.modelId);
  }
  if (p.from != null) {
    whereParts.push("ts >= ?");
    args.push(p.from);
  }
  if (p.to != null) {
    whereParts.push("ts < ?");
    args.push(p.to);
  }
  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM provider_calls ${where}`)
    .get(...args) as { n: number };
  const rows = db
    .prepare(`SELECT * FROM provider_calls ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`)
    .all(...args, p.limit, p.offset) as Row[];

  return { rows: rows.map(rowToCall), total: totalRow.n };
}

export function getProviderCall(id: number): ProviderCall | null {
  const db = getLlmAuditDb();
  const row = db.prepare("SELECT * FROM provider_calls WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToCall(row) : null;
}

/** Distinct model ids seen in the log (for the panel's model filter). */
export function listAuditedModelIds(): string[] {
  const db = getLlmAuditDb();
  const rows = db
    .prepare("SELECT DISTINCT model_id AS m FROM provider_calls WHERE model_id IS NOT NULL ORDER BY m ASC")
    .all() as { m: string }[];
  return rows.map((r) => r.m);
}

/** Distinct session ids seen in the log, most recently active first, with
 *  the latest cwd / display name per session (no full session scan). */
export function listAuditedSessionIds(): AuditedSession[] {
  const db = getLlmAuditDb();
  const rows = db
    .prepare(
      `SELECT session_id AS s, MAX(ts) AS lastTs,
              MAX(cwd) AS cwd, MAX(session_name) AS name
       FROM provider_calls WHERE session_id IS NOT NULL
       GROUP BY session_id ORDER BY lastTs DESC LIMIT 500`,
    )
    .all() as { s: string; lastTs: number; cwd: string | null; name: string | null }[];
  return rows.map((r) => ({ sessionId: r.s, lastTs: r.lastTs, cwd: r.cwd, name: r.name }));
}

export interface LlmAuditTotals {
  calls: number;
  errors: number;
  /** Total body bytes stored for non-2xx responses. */
  errorBodyBytes: number;
}

export function auditTotals(): LlmAuditTotals {
  const db = getLlmAuditDb();
  const calls = (db.prepare("SELECT COUNT(*) AS n FROM provider_calls").get() as { n: number }).n;
  const errors = (
    db.prepare("SELECT COUNT(*) AS n FROM provider_calls WHERE status IS NULL OR status < 200 OR status >= 300").get() as { n: number }
  ).n;
  const bytes = (
    db.prepare("SELECT COALESCE(SUM(LENGTH(response_body)), 0) AS b FROM provider_calls WHERE status IS NULL OR status < 200 OR status >= 300").get() as { b: number }
  ).b;
  return { calls, errors, errorBodyBytes: bytes };
}

/** Prune rows older than the given cutoff (ms). Returns deleted count. */
export function pruneProviderCalls(beforeTs: number): number {
  const db = getLlmAuditDb();
  const res = db.prepare("DELETE FROM provider_calls WHERE ts < ?").run(beforeTs);
  return res.changes;
}
