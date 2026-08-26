/**
 * Per-channel activity feed, persisted to `channels.db`.
 *
 * Every meaningful lifecycle event (message received, cold start, sent to
 * the agent, agent done / error, reply, token expiry, worker start/stop)
 * is recorded keyed by `channelId`, so the channel details UI can show
 * "what is happening right now" without reading server logs.
 *
 * Storage is deliberately SQLite (same file as channel metadata) rather
 * than an in-memory Map: Next.js may load instrumentation (worker side)
 * and route handlers (API side) as separate module instances, each with
 * its own module-scope singletons. In-memory state written on one side
 * would be invisible to the other. Because `db()` is a globalThis-cached
 * handle to a single file, persisting to the DB makes every instance read
 * the same data.
 *
 * Old rows are pruned opportunistically (a rolling time window) so the
 * table doesn't grow without bound.
 */
import { db } from "./db";
import type { ChannelActivity } from "@/lib/shared/channels/types";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("channels/activity");

/** Keep events within a rolling window; older rows are pruned lazily. */
const PRUNE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Prune roughly once per N inserts. */
const PRUNE_EVERY = 100;
let insertCounter = 0;

function ensureTable(): void {
  const handle = db();
  handle.exec(`CREATE TABLE IF NOT EXISTS channel_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT,
    from_user_id TEXT,
    session_id TEXT,
    duration_ms INTEGER,
    detail TEXT
  );`);
  handle.exec(`CREATE INDEX IF NOT EXISTS idx_channel_activity_channel_ts ON channel_activity(channel_id, ts);`);
}

/** Record one lifecycle event for a channel. Never throws. */
export function pushActivity(channelId: string, event: Omit<ChannelActivity, "ts" | "kind"> & { kind: ChannelActivity["kind"] }): void {
  try {
    ensureTable();
    const rows = db()
      .prepare(
        "INSERT INTO channel_activity (channel_id, ts, kind, text, from_user_id, session_id, duration_ms, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        channelId,
        new Date().toISOString(),
        event.kind,
        event.text ?? null,
        event.fromUserId ?? null,
        event.sessionId ?? null,
        event.durationMs ?? null,
        event.detail ?? null,
      );
    if (rows.changes > 0) {
      insertCounter += 1;
      if (insertCounter >= PRUNE_EVERY) {
        insertCounter = 0;
        try {
          prune(PRUNE_WINDOW_MS);
        } catch {
          // best effort
        }
      }
    }
  } catch {
    // never let activity recording break the message flow
    log.debug("pushActivity failed", { channelId });
  }
}

/** Return the most recent events for a channel, newest first. */
export function listActivity(channelId: string, limit = 50): ChannelActivity[] {
  try {
    ensureTable();
    const rows = db()
      .prepare(
        "SELECT ts, kind, text, from_user_id, session_id, duration_ms, detail FROM channel_activity WHERE channel_id = ? ORDER BY ts DESC, id DESC LIMIT ?",
      )
      .all(channelId, limit) as Array<{
      ts: string;
      kind: string;
      text: string | null;
      from_user_id: string | null;
      session_id: string | null;
      duration_ms: number | null;
      detail: string | null;
    }>;
    return rows.map((row) => ({
      ts: row.ts,
      kind: row.kind as ChannelActivity["kind"],
      text: row.text ?? undefined,
      fromUserId: row.from_user_id ?? undefined,
      sessionId: row.session_id ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      detail: row.detail ?? undefined,
    }));
  } catch {
    return [];
  }
}

/** Drop all buffered activity for a channel (delete / re-login). */
export function clearActivity(channelId: string): void {
  try {
    ensureTable();
    db().prepare("DELETE FROM channel_activity WHERE channel_id = ?").run(channelId);
  } catch {
    // best effort
  }
}

/** Remove rows older than `olderThanMs`; returns the number removed. */
export function prune(olderThanMs: number): number {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const result = db()
    .prepare("DELETE FROM channel_activity WHERE ts < ?")
    .run(cutoff);
  return result.changes;
}