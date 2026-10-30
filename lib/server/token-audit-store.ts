import { getTokenAuditDb } from "./token-audit-db";
import { createLogger } from "./logger";
import { parseLocalHourKey } from "./hour-series";
import { deriveCallThroughput, isCallSource } from "../shared/model-call-metrics";
import type {
  CallPurpose,
  CallSource,
  CallStatus,
  HourBucket,
  Range,
  GroupBy,
  MessageCallMetrics,
  ModelCallInsert,
  SummarizeResult,
  SummaryBucket,
  Source,
  SessionUsageSummary,
  TokenCall,
  TokenCallInsert,
  ListCallsParams,
} from "../shared/token-audit-types";

const log = createLogger("token-audit-store");

export type { CallPurpose, CallSource, CallStatus, HourBucket, Range, GroupBy, MessageCallMetrics, ModelCallInsert, Source, SummaryBucket, SummarizeResult, TokenCall, TokenCallInsert, ListCallsParams };

const CALL_PURPOSES = new Set<CallPurpose>([
  "chat",
  "channel",
  "compaction",
  "branch-summary",
  "translation",
  "auto-name",
  "unknown",
]);
const CALL_STATUSES = new Set<CallStatus>(["completed", "failed", "cancelled", "unknown"]);

function mapSource(value: string | null): CallSource {
  return isCallSource(value) ? value : "unknown";
}

function mapPurpose(value: string | null): CallPurpose {
  return value && CALL_PURPOSES.has(value as CallPurpose) ? (value as CallPurpose) : "unknown";
}

function mapStatus(value: string | null): CallStatus {
  return value && CALL_STATUSES.has(value as CallStatus) ? (value as CallStatus) : "unknown";
}

interface Row {
  id: number;
  call_id: string;
  started_at: number;
  session_id: string | null;
  message_id: string | null;
  source: string;
  purpose: string;
  status: string;
  provider: string;
  model_id: string;
  api: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_input: number | null;
  cost_output: number | null;
  cost_read: number | null;
  cost_write: number | null;
  cost_total: number | null;
  duration_ms: number | null;
  error: string | null;
  ttft_ms: number | null;
  generation_duration_ms: number | null;
}

function rowToCall(r: Row): TokenCall {
  const status = mapStatus(r.status);
  const { generationTps, endToEndTps } = deriveCallThroughput({
    status,
    outputTokens: r.output_tokens,
    generationDurationMs: r.generation_duration_ms,
    durationMs: r.duration_ms,
  });
  return {
    id: r.id,
    callId: r.call_id,
    ts: r.started_at,
    sessionId: r.session_id,
    messageId: r.message_id,
    source: mapSource(r.source),
    purpose: mapPurpose(r.purpose),
    status,
    provider: r.provider,
    modelId: r.model_id,
    api: r.api,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    costInput: r.cost_input,
    costOutput: r.cost_output,
    costRead: r.cost_read,
    costWrite: r.cost_write,
    costTotal: r.cost_total,
    durationMs: r.duration_ms,
    error: r.error,
    ttftMs: r.ttft_ms,
    generationDurationMs: r.generation_duration_ms,
    generationTps,
    endToEndTps,
  };
}

function rangeCutoff(range: Range): number | null {
  const now = Date.now();
  if (range === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (range === "7d") return now - 7 * 86_400_000;
  if (range === "30d") return now - 30 * 86_400_000;
  return null;
}

const INSERT_SQL = `
  INSERT OR IGNORE INTO token_calls
    (ts, session_id, message_id, source, provider, model_id, api,
     input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
     cost_input, cost_output, cost_read, cost_write, cost_total,
     duration_ms, error)
  VALUES
    (@ts, @sessionId, @messageId, @source, @provider, @modelId, @api,
     @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens,
     @costInput, @costOutput, @costRead, @costWrite, @costTotal,
     @durationMs, @error)
`;

export function recordCall(input: TokenCallInsert): void {
  const db = getTokenAuditDb();
  db.prepare(INSERT_SQL).run(input);
}

const INSERT_MODEL_CALL_SQL = `
  INSERT OR IGNORE INTO model_calls
    (call_id, started_at, session_id, message_id, source, purpose,
     provider, model_id, api, status,
     ttft_ms, generation_duration_ms, duration_ms, output_tokens, error)
  VALUES
    (@callId, @startedAt, @sessionId, @messageId, @source, @purpose,
     @provider, @modelId, @api, @status,
     @ttftMs, @generationDurationMs, @durationMs, @outputTokens, @error)
`;

export function recordModelCall(input: ModelCallInsert): void {
  getTokenAuditDb().prepare(INSERT_MODEL_CALL_SQL).run(input);
}

function unifiedCallsQuery(range: Range, sessionId?: string | null): { sql: string; args: unknown[] } {
  const cutoff = rangeCutoff(range);

  const legacyWhere: string[] = [];
  const legacyArgs: unknown[] = [];
  if (cutoff !== null) {
    legacyWhere.push("t.ts >= ?");
    legacyArgs.push(cutoff);
  }
  if (sessionId) {
    legacyWhere.push("t.session_id = ?");
    legacyArgs.push(sessionId);
  }
  const legacyWhereSql = legacyWhere.length ? `AND ${legacyWhere.join(" AND ")}` : "";

  const callWhere: string[] = [];
  const callArgs: unknown[] = [];
  if (cutoff !== null) {
    callWhere.push("m.started_at >= ?");
    callArgs.push(cutoff);
  }
  if (sessionId) {
    callWhere.push("m.session_id = ?");
    callArgs.push(sessionId);
  }
  const callWhereSql = callWhere.length ? `WHERE ${callWhere.join(" AND ")}` : "";

  const legacySql = `
    SELECT
      t.id AS id,
      'token:' || t.id AS call_id,
      t.ts AS started_at,
      t.session_id AS session_id,
      t.message_id AS message_id,
      t.source AS source,
      'unknown' AS purpose,
      CASE WHEN t.error IS NOT NULL THEN 'failed' ELSE 'unknown' END AS status,
      t.provider AS provider,
      t.model_id AS model_id,
      t.api AS api,
      t.input_tokens AS input_tokens,
      t.output_tokens AS output_tokens,
      t.cache_read_tokens AS cache_read_tokens,
      t.cache_write_tokens AS cache_write_tokens,
      t.cost_input AS cost_input,
      t.cost_output AS cost_output,
      t.cost_read AS cost_read,
      t.cost_write AS cost_write,
      t.cost_total AS cost_total,
      t.duration_ms AS duration_ms,
      t.error AS error,
      NULL AS ttft_ms,
      NULL AS generation_duration_ms
    FROM token_calls t
    WHERE NOT EXISTS (
      SELECT 1 FROM model_calls m
      WHERE m.message_id IS NOT NULL
        AND m.session_id = t.session_id
        AND m.message_id = t.message_id
    )
    ${legacyWhereSql}
  `;

  const callsSql = `
    SELECT
      m.id AS id,
      m.call_id AS call_id,
      m.started_at AS started_at,
      m.session_id AS session_id,
      m.message_id AS message_id,
      m.source AS source,
      m.purpose AS purpose,
      m.status AS status,
      m.provider AS provider,
      m.model_id AS model_id,
      m.api AS api,
      t.input_tokens AS input_tokens,
      -- Metric facts are authoritative when a metrics row exists: falling back
      -- to the billing row would turn "usage not reported" (NULL) into the
      -- billing placeholder 0 and fabricate a zero TPS.
      m.output_tokens AS output_tokens,
      t.cache_read_tokens AS cache_read_tokens,
      t.cache_write_tokens AS cache_write_tokens,
      t.cost_input AS cost_input,
      t.cost_output AS cost_output,
      t.cost_read AS cost_read,
      t.cost_write AS cost_write,
      t.cost_total AS cost_total,
      m.duration_ms AS duration_ms,
      COALESCE(m.error, t.error) AS error,
      m.ttft_ms AS ttft_ms,
      m.generation_duration_ms AS generation_duration_ms
    FROM model_calls m
    LEFT JOIN token_calls t
      ON m.message_id IS NOT NULL
     AND t.session_id = m.session_id
     AND t.message_id = m.message_id
    ${callWhereSql}
  `;

  return { sql: `${legacySql} UNION ALL ${callsSql}`, args: [...legacyArgs, ...callArgs] };
}

export function listCalls(p: ListCallsParams): { rows: TokenCall[]; total: number } {
  const db = getTokenAuditDb();
  const { sql, args } = unifiedCallsQuery(p.range, p.sessionId);

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM (${sql})`)
    .get(...args) as { n: number };
  const rows = db
    .prepare(
      `SELECT * FROM (${sql}) ORDER BY started_at DESC, call_id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, p.limit, p.offset) as Row[];

  return { rows: rows.map(rowToCall), total: totalRow.n };
}

interface MessageMetricRow {
  message_id: string;
  status: string;
  output_tokens: number | null;
  duration_ms: number | null;
  ttft_ms: number | null;
  generation_duration_ms: number | null;
}

export function listMessageCallMetrics(sessionId: string): MessageCallMetrics[] {
  const rows = getTokenAuditDb()
    .prepare(
      `SELECT message_id, status, output_tokens, duration_ms, ttft_ms, generation_duration_ms
         FROM model_calls
        WHERE session_id = ? AND message_id IS NOT NULL
        ORDER BY id ASC`,
    )
    .all(sessionId) as MessageMetricRow[];

  const byMessage = new Map<string, MessageCallMetrics>();
  for (const r of rows) {
    if (!r.message_id) continue;
    const status = mapStatus(r.status);
    const { generationTps } = deriveCallThroughput({
      status,
      outputTokens: r.output_tokens,
      generationDurationMs: r.generation_duration_ms,
      durationMs: r.duration_ms,
    });
    byMessage.set(r.message_id, {
      messageId: r.message_id,
      status,
      ttftMs: r.ttft_ms,
      generationDurationMs: r.generation_duration_ms,
      generationTps,
      outputTokens: r.output_tokens,
    });
  }
  return [...byMessage.values()];
}

export function listMessageCallIds(sessionId: string, messageId: string): string[] {
  const rows = getTokenAuditDb()
    .prepare(
      `SELECT call_id FROM model_calls
        WHERE session_id = ? AND message_id = ?
        ORDER BY started_at ASC, id ASC`,
    )
    .all(sessionId, messageId) as { call_id: string }[];
  return rows.map((r) => r.call_id);
}

const AGG_COLS = `
  COUNT(*)                     AS calls,
  SUM(input_tokens)            AS inputTokens,
  SUM(output_tokens)           AS outputTokens,
  SUM(cache_read_tokens)       AS cacheReadTokens,
  SUM(cache_write_tokens)      AS cacheWriteTokens,
  SUM(cost_total)              AS costTotal,
  SUM(duration_ms)             AS durationMs,
  MIN(ts)                      AS firstAt,
  MAX(ts)                      AS lastAt
`;

interface AggregateRow {
  key: string;
  calls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costTotal: number | null;
  durationMs: number | null;
  firstAt: number | null;
  lastAt: number | null;
}

function rowToBucket(r: AggregateRow): SummaryBucket {
  return {
    key: r.key,
    calls: r.calls ?? 0,
    inputTokens: r.inputTokens ?? 0,
    outputTokens: r.outputTokens ?? 0,
    cacheReadTokens: r.cacheReadTokens ?? 0,
    cacheWriteTokens: r.cacheWriteTokens ?? 0,
    costTotal: r.costTotal ?? 0,
    durationMs: r.durationMs ?? 0,
    firstAt: r.firstAt ?? 0,
    lastAt: r.lastAt ?? 0,
  };
}

function emptyBucket(): SummaryBucket {
  return {
    key: "*",
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costTotal: 0,
    durationMs: 0,
    firstAt: 0,
    lastAt: 0,
  };
}

export function summarize(range: Range, groupBy: GroupBy, sessionIds?: string[]): SummarizeResult {
  const db = getTokenAuditDb();
  const cutoff = rangeCutoff(range);
  const where: string[] = [];
  const args: unknown[] = [];
  if (cutoff !== null) {
    where.push("ts >= ?");
    args.push(cutoff);
  }
  if (sessionIds) {
    if (sessionIds.length === 0) {
      where.push("1 = 0");
    } else {
      where.push(`session_id IN (${sessionIds.map(() => "?").join(", ")})`);
      args.push(...sessionIds);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  if (groupBy === "none") {
    const row = db
      .prepare(`SELECT ${AGG_COLS} FROM token_calls ${whereSql}`)
      .get(...args) as AggregateRow | undefined;
    const totals = row ? rowToBucket({ ...row, key: "*" }) : emptyBucket();
    return { buckets: [], totals };
  }

  if (groupBy === "hour") {
    const hourCols = `
      (strftime('%Y-%m-%d %H:00', ts / 1000, 'unixepoch', 'localtime')) AS key,
      COUNT(*)                    AS calls,
      SUM(input_tokens)           AS inputTokens,
      SUM(output_tokens)          AS outputTokens,
      SUM(cache_read_tokens)      AS cacheReadTokens,
      SUM(cache_write_tokens)     AS cacheWriteTokens,
      SUM(cost_total)             AS costTotal,
      SUM(duration_ms)            AS durationMs,
      MIN(ts)                     AS firstAt,
      MAX(ts)                     AS lastAt
    `;
    const rows = db
      .prepare(
        `SELECT ${hourCols} FROM token_calls ${whereSql} GROUP BY key ORDER BY key ASC`,
      )
      .all(...args) as AggregateRow[];
    const buckets: HourBucket[] = rows.map((r) => {
      const b = rowToBucket(r);
      const tsMs = parseLocalHourKey(r.key);
      const avgDurationMs = b.calls > 0 ? b.durationMs / b.calls : 0;
      return { ...b, tsMs, avgDurationMs };
    });
    const totRow = db
      .prepare(`SELECT ${AGG_COLS} FROM token_calls ${whereSql}`)
      .get(...args) as AggregateRow | undefined;
    const totals = totRow ? rowToBucket({ ...totRow, key: "*" }) : emptyBucket();
    return { buckets, totals };
  }

  const groupExpr =
    groupBy === "session"
      ? "session_id"
      : groupBy === "model"
        ? "(provider || '/' || model_id)"
        : "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')";

  const rows = db
    .prepare(
      `
      SELECT ${groupExpr} AS key, ${AGG_COLS}
        FROM token_calls
        ${whereSql}
        GROUP BY key
      UNION ALL
      SELECT '*' AS key, ${AGG_COLS}
        FROM token_calls
        ${whereSql}
      `,
    )
    .all(...args, ...args) as AggregateRow[];

  const totals = emptyBucket();
  const buckets: SummaryBucket[] = [];
  for (const row of rows) {
    const b = rowToBucket(row);
    if (b.key === "*") {
      totals.calls = b.calls;
      totals.inputTokens = b.inputTokens;
      totals.outputTokens = b.outputTokens;
      totals.cacheReadTokens = b.cacheReadTokens;
      totals.cacheWriteTokens = b.cacheWriteTokens;
      totals.costTotal = b.costTotal;
      totals.durationMs = b.durationMs;
      totals.firstAt = b.firstAt;
      totals.lastAt = b.lastAt;
    } else {
      buckets.push(b);
    }
  }

  buckets.sort((a, b) => {
    if (b.costTotal !== a.costTotal) return b.costTotal - a.costTotal;
    return b.calls - a.calls;
  });

  return { buckets, totals };
}

interface SessionUsageAggregateRow {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costTotal: number | null;
}

interface SessionCallMetricRow {
  status: string;
  purpose: string;
  output_tokens: number | null;
  duration_ms: number | null;
  ttft_ms: number | null;
  generation_duration_ms: number | null;
}

const MIN_GENERATION_WINDOW_MS = 200;

function emptySessionUsage(): SessionUsageSummary {
  return {
    inputTokens: 0,
    inputTokensWithCache: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costTotal: 0,
    cacheHitRate: null,
    avgTtftMs: null,
    avgGenerationTps: null,
  };
}

export function summarizeSessions(sessionIds: readonly string[]): SessionUsageSummary {
  const ids = [...new Set(sessionIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return emptySessionUsage();
  const placeholders = ids.map(() => "?").join(", ");

  const db = getTokenAuditDb();
  const totals = db
    .prepare(
      `SELECT SUM(input_tokens)        AS inputTokens,
              SUM(output_tokens)       AS outputTokens,
              SUM(cache_read_tokens)   AS cacheReadTokens,
              SUM(cache_write_tokens)  AS cacheWriteTokens,
              SUM(cost_total)          AS costTotal
         FROM token_calls
        WHERE session_id IN (${placeholders})`,
    )
    .get(...ids) as SessionUsageAggregateRow | undefined;

  const inputTokens = totals?.inputTokens ?? 0;
  const outputTokens = totals?.outputTokens ?? 0;
  const cacheReadTokens = totals?.cacheReadTokens ?? 0;
  const cacheWriteTokens = totals?.cacheWriteTokens ?? 0;
  const hitDenom = inputTokens + cacheReadTokens;

  const metricRows = db
    .prepare(
      `SELECT status, purpose, output_tokens, duration_ms, ttft_ms, generation_duration_ms
         FROM model_calls
        WHERE session_id IN (${placeholders})`,
    )
    .all(...ids) as SessionCallMetricRow[];

  let ttftSum = 0;
  let ttftCount = 0;
  let throughputTokens = 0;
  let throughputDurationMs = 0;
  for (const row of metricRows) {
    if (typeof row.ttft_ms === "number" && Number.isFinite(row.ttft_ms) && row.ttft_ms >= 0) {
      ttftSum += row.ttft_ms;
      ttftCount += 1;
    }
    if (mapPurpose(row.purpose) !== "chat") continue;
    if (
      typeof row.generation_duration_ms !== "number" ||
      row.generation_duration_ms < MIN_GENERATION_WINDOW_MS
    ) {
      continue;
    }
    const { generationTps } = deriveCallThroughput({
      status: mapStatus(row.status),
      outputTokens: row.output_tokens,
      generationDurationMs: row.generation_duration_ms,
      durationMs: row.duration_ms,
    });
    if (generationTps === null || row.output_tokens === null) continue;
    throughputTokens += row.output_tokens;
    throughputDurationMs += row.generation_duration_ms;
  }

  return {
    inputTokens,
    inputTokensWithCache: inputTokens + cacheReadTokens + cacheWriteTokens,
    outputTokens,
    totalTokens: inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costTotal: totals?.costTotal ?? 0,
    cacheHitRate: hitDenom > 0 ? cacheReadTokens / hitDenom : null,
    avgTtftMs: ttftCount > 0 ? ttftSum / ttftCount : null,
    avgGenerationTps:
      throughputDurationMs > 0 ? (throughputTokens * 1000) / throughputDurationMs : null,
  };
}

export function clearAllData(): { ok: true; deleted: number } {
  const db = getTokenAuditDb();
  const billing = (db.prepare("SELECT COUNT(*) AS n FROM token_calls").get() as { n: number }).n;
  const calls = (db.prepare("SELECT COUNT(*) AS n FROM model_calls").get() as { n: number }).n;
  db.exec("DELETE FROM token_calls");
  db.exec("DELETE FROM model_calls");
  const deleted = billing + calls;
  log.info("token-audit cleared", { deleted, billing, calls });
  return { ok: true, deleted };
}
