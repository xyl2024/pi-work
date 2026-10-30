import Database from "better-sqlite3";
import { dirname } from "path";
import { mkdirSync } from "fs";
import { createLogger } from "./logger";
import { dataPath } from "./data-dir";
import type {
  AuditedSession,
  LlmAuditSource,
  ListProviderCallsParams,
  ProviderCall,
  ProviderCallInsert,
} from "../shared/llm-audit-types";

const log = createLogger("llm-audit-db");

declare global {
  var __piLlmAuditDb: Database.Database | undefined;
  var __piLlmAuditLastPrune: number | undefined;
}

function resolveDbPath(): string {
  const override = process.env.PI_WORK_LLM_AUDIT_DB?.trim();
  if (override) return override;
  return dataPath("llm-audit.db");
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
    call_id           TEXT,
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

const POST_MIGRATION_INDEXES: string[] = [
  "CREATE INDEX IF NOT EXISTS idx_provider_calls_call ON provider_calls(call_id)",
];

const MIGRATIONS: string[] = [
  "ALTER TABLE provider_calls ADD COLUMN cwd TEXT",
  "ALTER TABLE provider_calls ADD COLUMN session_name TEXT",
  "ALTER TABLE provider_calls ADD COLUMN call_id TEXT",
];

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
  for (const index of POST_MIGRATION_INDEXES) {
    try {
      db.exec(index);
    } catch (e) {
      log.warn("llm-audit index creation failed", { index, error: String(e) });
    }
  }
}

export function getLlmAuditDb(): Database.Database {
  if (globalThis.__piLlmAuditDb) {
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
  schedulePrune();
  log.info("llm-audit db opened", { dbPath });
  return db;
}

const DEFAULT_RETENTION_DAYS = 30;

const PRUNE_BATCH_ROWS = 500;

const PRUNE_MAX_BATCHES = 40;

const PRUNE_THROTTLE_MS = 5 * 60 * 1000;

function retentionDays(): number {
  const raw = process.env.PI_WORK_LLM_AUDIT_RETENTION_DAYS?.trim();
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS;
  return Math.floor(n);
}

export function pruneProviderCalls(now = Date.now()): number {
  const days = retentionDays();
  if (days <= 0) return 0;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const db = getLlmAuditDb();
  const stmt = db.prepare(
    `DELETE FROM provider_calls WHERE id IN (
       SELECT id FROM provider_calls WHERE ts < ? ORDER BY ts ASC LIMIT ?
     )`,
  );
  let deleted = 0;
  for (let i = 0; i < PRUNE_MAX_BATCHES; i++) {
    const changes = stmt.run(cutoff, PRUNE_BATCH_ROWS).changes;
    deleted += changes;
    if (changes < PRUNE_BATCH_ROWS) break;
  }
  return deleted;
}

function schedulePrune(): void {
  const now = Date.now();
  if (now - (globalThis.__piLlmAuditLastPrune ?? 0) < PRUNE_THROTTLE_MS) return;
  globalThis.__piLlmAuditLastPrune = now;
  setImmediate(() => {
    try {
      const deleted = pruneProviderCalls(Date.now());
      if (deleted > 0) log.info("llm-audit pruned old rows", { deleted, retentionDays: retentionDays() });
    } catch (e) {
      log.warn("llm-audit prune failed", { error: String(e) });
    }
  });
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
  call_id: string | null;
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
    callId: r.call_id,
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
  if (s === "user" || s === "scheduled" || s === "subagent" || s === "direct" || s === "btw") return s;
  return "unknown";
}

const INSERT_SQL = `
  INSERT INTO provider_calls
    (ts, session_id, source, provider, model_id, api, url, attempt, call_id,
     request_body, request_headers, status, response_headers, response_body,
     error, duration_ms, cwd, session_name)
  VALUES
    (@ts, @sessionId, @source, @provider, @modelId, @api, @url, @attempt, @callId,
     @requestBody, @requestHeaders, @status, @responseHeaders, @responseBody,
     @error, @durationMs, @cwd, @sessionName)
`;

export function insertProviderCall(input: ProviderCallInsert): number {
  const db = getLlmAuditDb();
  const res = db.prepare(INSERT_SQL).run(input);
  schedulePrune();
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
  if (p.source) {
    whereParts.push("source = ?");
    args.push(p.source);
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

export function listProviderCallsByCallIds(callIds: readonly string[]): ProviderCall[] {
  if (callIds.length === 0) return [];
  const db = getLlmAuditDb();
  const placeholders = callIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM provider_calls WHERE call_id IN (${placeholders}) ORDER BY ts ASC, id ASC`)
    .all(...callIds) as Row[];
  return rows.map(rowToCall);
}

export function listAuditedModelIds(): string[] {
  const db = getLlmAuditDb();
  const rows = db
    .prepare("SELECT DISTINCT model_id AS m FROM provider_calls WHERE model_id IS NOT NULL ORDER BY m ASC")
    .all() as { m: string }[];
  return rows.map((r) => r.m);
}

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
