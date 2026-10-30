import type { ProviderCall } from "./llm-audit-types";

export type RequestAttempt = Pick<
  ProviderCall,
  "id" | "ts" | "attempt" | "status" | "modelId" | "requestBody"
>;

function isSuccess(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

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

export function requestBodyFileName(attempt: RequestAttempt): string {
  return `request-body-${fileSegment(attempt.modelId, "unknown")}-${fileStamp(attempt.ts)}.json`;
}
