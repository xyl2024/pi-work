/**
 * Client-safe shared types for the LLM API call audit feature.
 *
 * Dependency-free so the panel and any other browser-side importer can
 * `import type` from here without dragging `better-sqlite3` / `fs` /
 * `@earendil-works/pi-coding-agent` into the client bundle.
 */

export type LlmAuditSource = "user" | "scheduled" | "direct" | "unknown";

/** One row = one actual HTTP request to an LLM provider (incl. retries). */
export interface ProviderCall {
  id: number;
  /** Epoch ms when the request was issued. */
  ts: number;
  sessionId: string | null;
  source: LlmAuditSource;
  /** Session cwd at call time (from the audit context). */
  cwd: string | null;
  /** Session display name at call time, if any. */
  sessionName: string | null;
  provider: string | null;
  modelId: string | null;
  api: string | null;
  url: string;
  /** Retry ordinal within a session turn (1-based). */
  attempt: number;
  /** Full raw request body (JSON), as actually sent. */
  requestBody: string | null;
  /** Request headers as JSON, with sensitive values masked. */
  requestHeaders: string | null;
  /** HTTP status of the response. NULL for network-level failures (no response). */
  status: number | null;
  /** Response headers as JSON. */
  responseHeaders: string | null;
  /** Full raw response body. Only populated for non-2xx responses. */
  responseBody: string | null;
  /** Network-level error message (fetch threw before a response arrived). */
  error: string | null;
  /** ms from request issue to response headers (or failure). */
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
  /** "ok" = 2xx, "error" = non-2xx or network error, undefined = all */
  status?: "ok" | "error" | null;
  modelId?: string | null;
  /** Epoch-ms lower bound (inclusive). */
  from?: number | null;
  /** Epoch-ms upper bound (exclusive). */
  to?: number | null;
}
