import { db } from "./db";
import type { ChannelActivity } from "@/lib/shared/channels/types";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("channels/activity");

const PRUNE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
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
        }
      }
    }
  } catch {
    log.debug("pushActivity failed", { channelId });
  }
}

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

export function prune(olderThanMs: number): number {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const result = db()
    .prepare("DELETE FROM channel_activity WHERE ts < ?")
    .run(cutoff);
  return result.changes;
}