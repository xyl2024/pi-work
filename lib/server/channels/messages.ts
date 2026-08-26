/**
 * Per-channel inbound message idempotency store.
 *
 * The upstream WeChat poller uses a sync cursor and may deliver the same
 * message more than once (retries, cursor rollback, duplicate pushes), and
 * an inbound batch can be processed concurrently with a re-login. Without
 * a dedupe key the channel would reply twice for one user message.
 *
 * Table `channel_messages` lives in the same SQLite file as the channel
 * metadata (channels.db) and is keyed by (channel_id, message_key). A
 * call to `claimMessage` atomically reserves the key for processing;
 * `markProcessed` records success; `abandonMessage` releases a failed
 * key so a redelivery can be retried. Old rows are pruned opportunistically.
 */
import { createHash } from "crypto";
import { db } from "./db";

export type ClaimResult = "accepted" | "duplicate" | "in_progress";

export interface MessageKeyParts {
  /** Reliable upstream message id, when available. */
  messageId?: number | string;
  channelId: string;
  userId: string;
  createTimeMs?: number;
  text: string;
}

/** Default: text is truncated before hashing so the row stays small. */
const TEXT_PREFIX_LEN = 200;

/**
 * Build a stable per-channel message key.
 *
 * Prefer the upstream `message_id` when present — it is globally unique
 * per sender. Fall back to a hash of (channel, user, time, text prefix)
 * for messages that only carry a cursor-based seq or no id at all.
 */
export function buildMessageKey(parts: MessageKeyParts): string {
  if (parts.messageId !== undefined && parts.messageId !== null && String(parts.messageId) !== "") {
    return `id:${String(parts.messageId)}`;
  }
  const text = parts.text.slice(0, TEXT_PREFIX_LEN);
  const hash = createHash("sha1")
    .update([parts.channelId, parts.userId, String(parts.createTimeMs ?? ""), text].join("|"))
    .digest("hex")
    .slice(0, 24);
  return `hash:${hash}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Atomically reserve a message key for processing.
 *
 *  - `accepted`   — first time this key is claimed; caller owns it.
 *  - `duplicate`  — already processed successfully; skip silently.
 *  - `in_progress`— another in-flight call is handling it; skip.
 */
export function claimMessage(channelId: string, messageKey: string): ClaimResult {
  const statement = db().prepare(
    `INSERT INTO channel_messages (channel_id, message_key, status, received_at)
     VALUES (?, ?, 'processing', ?)
     ON CONFLICT (channel_id, message_key) DO NOTHING`,
  );
  const result = statement.run(channelId, messageKey, nowIso());
  if (result.changes > 0) return "accepted";
  const row = db()
    .prepare("SELECT status FROM channel_messages WHERE channel_id = ? AND message_key = ?")
    .get(channelId, messageKey) as { status: string } | undefined;
  if (row?.status === "done") return "duplicate";
  return "in_progress";
}

/** Mark a successfully processed message as done (dedupes redeliveries). */
export function markProcessed(channelId: string, messageKey: string): void {
  db()
    .prepare(
      "UPDATE channel_messages SET status = 'done', processed_at = ? WHERE channel_id = ? AND message_key = ?",
    )
    .run(nowIso(), channelId, messageKey);
}

/**
 * Release a key whose processing failed so a redelivery can be retried.
 * A no-op when the key was never claimed.
 */
export function abandonMessage(channelId: string, messageKey: string): void {
  db()
    .prepare("DELETE FROM channel_messages WHERE channel_id = ? AND message_key = ?")
    .run(channelId, messageKey);
}

/**
 * Delete message rows older than `olderThanMs` (default 48h). Returns the
 * number of removed rows. Called opportunistically from the worker so the
 * table doesn't grow forever.
 */
export function pruneMessages(olderThanMs = 48 * 60 * 60 * 1000): number {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const result = db()
    .prepare("DELETE FROM channel_messages WHERE received_at < ?")
    .run(cutoff);
  return result.changes;
}

/** Delete every idempotency row for a channel (re-login / delete). */
export function clearChannelMessages(channelId: string): void {
  db().prepare("DELETE FROM channel_messages WHERE channel_id = ?").run(channelId);
}