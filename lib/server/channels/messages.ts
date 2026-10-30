import { createHash } from "crypto";
import { db } from "./db";

export type ClaimResult = "accepted" | "duplicate" | "in_progress";

export interface MessageKeyParts {
  messageId?: number | string;
  channelId: string;
  userId: string;
  createTimeMs?: number;
  text: string;
}

const TEXT_PREFIX_LEN = 200;

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

export function markProcessed(channelId: string, messageKey: string): void {
  db()
    .prepare(
      "UPDATE channel_messages SET status = 'done', processed_at = ? WHERE channel_id = ? AND message_key = ?",
    )
    .run(nowIso(), channelId, messageKey);
}

export function abandonMessage(channelId: string, messageKey: string): void {
  db()
    .prepare("DELETE FROM channel_messages WHERE channel_id = ? AND message_key = ?")
    .run(channelId, messageKey);
}

export function pruneMessages(olderThanMs = 48 * 60 * 60 * 1000): number {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const result = db()
    .prepare("DELETE FROM channel_messages WHERE received_at < ?")
    .run(cutoff);
  return result.changes;
}

export function clearChannelMessages(channelId: string): void {
  db().prepare("DELETE FROM channel_messages WHERE channel_id = ?").run(channelId);
}