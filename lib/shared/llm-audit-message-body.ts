/**
 * Pure rules for "download the request body that produced this assistant
 * message".
 *
 * Client-safe: no `fs`, no SQLite, no pi SDK. The server module
 * (`lib/server/llm-audit-message-body.ts`) does the lookups and hands the
 * captured rows to these functions.
 */

import type { ProviderCall } from "./llm-audit-types";

/** The fields of a captured HTTP attempt needed to present its request body. */
export type RequestAttempt = Pick<
  ProviderCall,
  "id" | "ts" | "attempt" | "status" | "modelId" | "requestBody"
>;

function isSuccess(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

/**
 * Pick the captured request whose body actually produced the reply.
 *
 * Rows arrive in send order (`ts ASC`). A turn may issue several HTTP
 * attempts — retries after a 429/5xx, or an SDK retry — and only the one that
 * succeeded describes the conversation state the message was generated from.
 * When every attempt failed there is no successful body, so the last captured
 * attempt wins: it is the most recent thing the provider was actually sent.
 * Attempts without a body (non-string request init, audit insert failure) are
 * never candidates.
 */
export function selectRequestAttempt(rows: readonly RequestAttempt[]): RequestAttempt | null {
  let last: RequestAttempt | null = null;
  for (const row of rows) {
    if (row.requestBody === null) continue;
    if (isSuccess(row.status)) last = row;
  }
  if (last) return last;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].requestBody !== null) return rows[i];
  }
  return null;
}

/**
 * Pretty-print a captured request body. The body is stored exactly as it was
 * serialized for the wire (one long line), which is unreadable in a downloaded
 * file; re-indenting is what makes the download useful. A body that is not
 * JSON (or was truncated) is returned verbatim rather than dropped.
 */
export function formatRequestBody(raw: string | null): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function fileStamp(ts: number): string {
  return new Date(ts).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function fileSegment(value: string | null, fallback: string): string {
  const cleaned = (value ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

/**
 * Download name for one captured attempt, e.g.
 * `request-body-deepseek-chat-20240102T030405Z.json`.
 *
 * The capture time is written in UTC (`…Z`) so two messages of the same model
 * never collide, and the model segment is sanitized because provider model ids
 * can contain `/`, `:` and spaces that a filesystem would reject.
 */
export function requestBodyFileName(attempt: RequestAttempt): string {
  return `request-body-${fileSegment(attempt.modelId, "unknown")}-${fileStamp(attempt.ts)}.json`;
}
