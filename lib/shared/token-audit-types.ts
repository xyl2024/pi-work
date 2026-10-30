export type Range = "today" | "7d" | "30d" | "all";
export type GroupBy = "none" | "session" | "model" | "day" | "hour";

export type CallSource =
  | "user"
  | "scheduled"
  | "subagent"
  | "direct"
  | "btw"
  | "unknown";
export type Source = CallSource;

export type CallPurpose =
  | "chat"
  | "channel"
  | "compaction"
  | "branch-summary"
  | "translation"
  | "auto-name"
  | "unknown";

export interface ModelCallCommandOptions {
  purpose?: CallPurpose;
}

export type CallStatus = "completed" | "failed" | "cancelled" | "unknown";

export interface TokenCall {
  id: number;
  callId: string;
  ts: number;
  sessionId: string | null;
  messageId: string | null;
  source: CallSource;
  purpose: CallPurpose;
  status: CallStatus;
  provider: string;
  modelId: string;
  api: string | null;
  inputTokens: number | null;
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
  ttftMs: number | null;
  generationDurationMs: number | null;
  generationTps: number | null;
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
  avgDurationMs?: number;
}

export interface HourBucket extends SummaryBucket {
  tsMs: number;
}

export interface ModelCallInsert {
  callId: string;
  startedAt: number;
  sessionId: string | null;
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

export interface MessageCallMetrics {
  messageId: string;
  status: CallStatus;
  ttftMs: number | null;
  generationDurationMs: number | null;
  generationTps: number | null;
  outputTokens: number | null;
}

export interface SummarizeResult {
  buckets: SummaryBucket[];
  totals: SummaryBucket;
}

export interface SessionUsageSummary {
  inputTokens: number;
  inputTokensWithCache: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costTotal: number;
  cacheHitRate: number | null;
  avgTtftMs: number | null;
  avgGenerationTps: number | null;
}
