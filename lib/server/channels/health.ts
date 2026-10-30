import { db } from "./db";

export interface WorkerHealth {
  lastPollAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  nextRetryAt: string | null;
}

function ensureTable(): void {
  db().exec(`CREATE TABLE IF NOT EXISTS channel_worker_state (
    channel_id TEXT PRIMARY KEY,
    last_poll_at TEXT,
    last_failure_at TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    updated_at TEXT NOT NULL
  );`);
}

export function getWorkerHealth(channelId: string): WorkerHealth | null {
  try {
    ensureTable();
    const row = db()
      .prepare("SELECT last_poll_at, last_failure_at, consecutive_failures, next_retry_at FROM channel_worker_state WHERE channel_id = ?")
      .get(channelId) as
      | { last_poll_at: string | null; last_failure_at: string | null; consecutive_failures: number; next_retry_at: string | null }
      | undefined;
    if (!row) return null;
    return {
      lastPollAt: row.last_poll_at,
      lastFailureAt: row.last_failure_at,
      consecutiveFailures: row.consecutive_failures,
      nextRetryAt: row.next_retry_at,
    };
  } catch {
    return null;
  }
}

type HealthPatch = Partial<
  Pick<WorkerHealth, "lastPollAt" | "lastFailureAt" | "consecutiveFailures" | "nextRetryAt">
>;

export function updateWorkerHealth(channelId: string, patch: HealthPatch): void {
  try {
    ensureTable();
    const current = getWorkerHealth(channelId) ?? {
      lastPollAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      nextRetryAt: null,
    };
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    db()
      .prepare(
        `INSERT INTO channel_worker_state (channel_id, last_poll_at, last_failure_at, consecutive_failures, next_retry_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET
           last_poll_at = excluded.last_poll_at,
           last_failure_at = excluded.last_failure_at,
           consecutive_failures = excluded.consecutive_failures,
           next_retry_at = excluded.next_retry_at,
           updated_at = excluded.updated_at`,
      )
      .run(channelId, next.lastPollAt, next.lastFailureAt, next.consecutiveFailures, next.nextRetryAt, next.updatedAt);
  } catch {
  }
}

export function clearWorkerHealth(channelId: string): void {
  try {
    ensureTable();
    db().prepare("DELETE FROM channel_worker_state WHERE channel_id = ?").run(channelId);
  } catch {
  }
}