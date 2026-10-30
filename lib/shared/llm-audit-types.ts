export type LlmAuditSource = "user" | "scheduled" | "subagent" | "direct" | "btw" | "unknown";

export interface ProviderCall {
  id: number;
  ts: number;
  sessionId: string | null;
  source: LlmAuditSource;
  cwd: string | null;
  sessionName: string | null;
  provider: string | null;
  modelId: string | null;
  api: string | null;
  url: string;
  attempt: number;
  callId: string | null;
  requestBody: string | null;
  requestHeaders: string | null;
  status: number | null;
  responseHeaders: string | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number;
}

export interface ProviderCallInsert {
  ts: number;
  sessionId: string | null;
  source: LlmAuditSource;
  cwd: string | null;
  sessionName: string | null;
  provider: string | null;
  modelId: string | null;
  api: string | null;
  url: string;
  attempt: number;
  callId: string | null;
  requestBody: string | null;
  requestHeaders: string | null;
  status: number | null;
  responseHeaders: string | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number;
}

export interface AuditedSession {
  sessionId: string;
  lastTs: number;
  cwd: string | null;
  name: string | null;
}

export interface ListProviderCallsParams {
  limit: number;
  offset: number;
  sessionId?: string | null;
  status?: "ok" | "error" | null;
  modelId?: string | null;
  source?: LlmAuditSource | null;
  from?: number | null;
  to?: number | null;
}
