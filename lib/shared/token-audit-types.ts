/**
 * Client-safe shared types for the token-audit feature.
 *
 * Kept dependency-free so the panel and any other browser-side importer can
 * `import type` from here without dragging `better-sqlite3` / `fs` /
 * `@earendil-works/pi-coding-agent` into the client bundle.
 */

export type Range = "today" | "7d" | "30d" | "all";
export type GroupBy = "none" | "session" | "model" | "day" | "hour";

/** Who drove the logical model call. */
export type CallSource =
  | "user"
  | "scheduled"
  | "subagent"
  | "direct"
  | "btw"
  | "unknown";
/** Backward-compatible alias for the billing row's source column. */
export type Source = CallSource;

/** What the call was for, independent of who drove it. */
export type CallPurpose =
  | "chat"
  | "channel"
  | "compaction"
  | "branch-summary"
  | "translation"
  | "auto-name"
  | "unknown";

/**
 * Terminal state of one logical call. `unknown` exists for historical billing
 * rows that predate call-metric collection — it is never treated as success.
 */
export type CallStatus = "completed" | "failed" | "cancelled" | "unknown";

export interface TokenCall {
  id: number;
  /** Stable identifier for this logical call (not derived from a timestamp). */
  callId: string;
  /** Epoch ms when the logical call started. */
  ts: number;
  sessionId: string | null;
  messageId: string | null;
  source: CallSource;
  purpose: CallPurpose;
  status: CallStatus;
  provider: string;
  modelId: string;
  api: string | null;
  /** `null` when billing facts are unavailable (e.g. a failed call). */
  inputTokens: number | null;
  /** Provider-reported output tokens; `null` when usage was not reported. */
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costInput: number | null;
  costOutput: number | null;
  costRead: number | null;
  costWrite: number | null;
  costTotal: number | null;
  durationMs: number | null;
  error: string | null;
  /** First effective output − call start. `null` when no output was observed. */
  ttftMs: number | null;
  /** First effective output → last effective output. */
  generationDurationMs: number | null;
  /** Derived at read time; never stored. */
  generationTps: number | null;
  /** Derived at read time; never stored. */
  endToEndTps: number | null;
}

export interface TokenCallInsert {
  sessionId: string;
  messageId: string;
  source: Source;
  provider: string;
  modelId: string;
  api: string | null;
  ts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costInput: number;
  costOutput: number;
  costRead: number;
  costWrite: number;
  costTotal: number;
  durationMs: number;
  error: string | null;
}

export interface SummaryBucket {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costTotal: number;
  durationMs: number;
  firstAt: number;
  lastAt: number;
  /** Average per-call duration. Present in `groupBy="hour"` output. */
  avgDurationMs?: number;
}

/** Hourly bucket — extends SummaryBucket with the absolute timestamp of the
 *  hour start, used by the 24h bar chart in the UI. */
export interface HourBucket extends SummaryBucket {
  /** Epoch-ms of the hour bucket's start (local-time hour boundary). */
  tsMs: number;
}

/** Persisted facts for one logical model call (performance record). */
export interface ModelCallInsert {
  callId: string;
  /** Epoch ms when the logical call started (wall clock, for sorting/filtering). */
  startedAt: number;
  sessionId: string | null;
  /** Matches `token_calls.message_id` when a billing row exists for this call. */
  messageId: string | null;
  source: CallSource;
  purpose: CallPurpose;
  provider: string;
  modelId: string;
  api: string | null;
  status: CallStatus;
  ttftMs: number | null;
  generationDurationMs: number | null;
  durationMs: number | null;
  outputTokens: number | null;
  error: string | null;
}

export interface ListCallsParams {
  range: Range;
  limit: number;
  offset: number;
  sessionId?: string | null;
}

export interface SummarizeResult {
  buckets: SummaryBucket[];
  totals: SummaryBucket;
}
