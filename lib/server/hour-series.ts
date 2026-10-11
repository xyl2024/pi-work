/**
 * Pure helpers for time-bucketed (hourly) series used by token-audit.
 *
 * Client-safe — no DB, no fs, no Node imports. The panel reuses these on
 * the client side to fill empty hours in the 24h chart; the server-side
 * `summarize()` uses the same parser when normalizing SQLite localtime
 * keys. Keep this file dependency-free so any side (app, client
 * component) can import from it without dragging in `better-sqlite3`.
 */

import type { HourBucket, SummaryBucket } from "../shared/token-audit-types";

export type { HourBucket };

/**
 * Parse a SQLite localtime hour key like "2024-05-01 14:00" into epoch-ms.
 * Returns 0 if the key is malformed.
 */
export function parseLocalHourKey(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(key);
  if (!m) return 0;
  const [, y, mo, d, h, mi] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi, 0, 0).getTime();
}

/** Re-exported for callers that only need the upstream SummaryBucket shape. */
export type { SummaryBucket };
