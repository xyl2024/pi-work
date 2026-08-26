import Database from "better-sqlite3";
import { dirname } from "path";
import { mkdirSync } from "fs";
import { randomUUID } from "crypto";
import type { ChannelProvider, ChannelRecord, ChannelStatus } from "@/lib/shared/channels/types";
import { dataPath } from "../data-dir";

declare global {
  var __piChannelsDb: Database.Database | undefined;
}

function dbPath(): string {
  return process.env.PI_WORK_CHANNELS_DB?.trim() || dataPath("channels.db");
}

export function db(): Database.Database {
  if (globalThis.__piChannelsDb) return globalThis.__piChannelsDb;
  const file = dbPath();
  mkdirSync(dirname(file), { recursive: true });
  const handle = new Database(file);
  handle.pragma("journal_mode = WAL");
  handle.pragma("foreign_keys = ON");
  handle.exec(`CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    workspace_id TEXT,
    current_session_id TEXT,
    sync_buf TEXT NOT NULL DEFAULT '',
    account_id TEXT,
    user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_channels_provider_name ON channels(provider, name COLLATE NOCASE);`);
  handle.exec(`CREATE TABLE IF NOT EXISTS channel_messages (
    channel_id TEXT NOT NULL,
    message_key TEXT NOT NULL,
    status TEXT NOT NULL,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    PRIMARY KEY (channel_id, message_key)
  ); CREATE INDEX IF NOT EXISTS idx_channel_messages_received ON channel_messages(received_at);`);
  const columns = handle.prepare("PRAGMA table_info(channels)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "current_session_id")) handle.exec("ALTER TABLE channels ADD COLUMN current_session_id TEXT");
  if (!columns.some((column) => column.name === "sync_buf")) handle.exec("ALTER TABLE channels ADD COLUMN sync_buf TEXT NOT NULL DEFAULT ''");
  globalThis.__piChannelsDb = handle;
  return handle;
}

function rowToChannel(row: Record<string, unknown>): ChannelRecord {
  return {
    id: String(row.id), name: String(row.name), provider: row.provider as ChannelProvider,
    status: row.status as ChannelStatus, workspaceId: (row.workspace_id as string | null) ?? null,
    currentSessionId: (row.current_session_id as string | null) ?? null,
    syncBuf: String(row.sync_buf ?? ""),
    accountId: (row.account_id as string | null) ?? null, userId: (row.user_id as string | null) ?? null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function listChannels(provider?: ChannelProvider): ChannelRecord[] {
  const rows = provider
    ? db().prepare("SELECT * FROM channels WHERE provider = ? ORDER BY name COLLATE NOCASE ASC, created_at ASC").all(provider)
    : db().prepare("SELECT * FROM channels ORDER BY name COLLATE NOCASE ASC, created_at ASC").all();
  return (rows as Record<string, unknown>[]).map(rowToChannel);
}

export function getChannel(id: string): ChannelRecord | null {
  const row = db().prepare("SELECT * FROM channels WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToChannel(row) : null;
}

export function createChannel(name: string, provider: ChannelProvider = "wechat"): ChannelRecord {
  const now = new Date().toISOString();
  const channel: ChannelRecord = { id: randomUUID(), name: name.trim(), provider, status: "pending", workspaceId: null, currentSessionId: null, syncBuf: "", accountId: null, userId: null, createdAt: now, updatedAt: now };
  db().prepare("INSERT INTO channels (id,name,provider,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(channel.id, channel.name, provider, channel.status, now, now);
  return channel;
}

export function updateChannel(id: string, patch: Partial<Pick<ChannelRecord, "name" | "status" | "workspaceId" | "currentSessionId" | "syncBuf" | "accountId" | "userId">>): ChannelRecord | null {
  const current = getChannel(id);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  db().prepare("UPDATE channels SET name=?, status=?, workspace_id=?, current_session_id=?, sync_buf=?, account_id=?, user_id=?, updated_at=? WHERE id=?").run(next.name, next.status, next.workspaceId, next.currentSessionId, next.syncBuf, next.accountId, next.userId, next.updatedAt, id);
  return next;
}

export function deleteChannel(id: string): boolean {
  return db().prepare("DELETE FROM channels WHERE id=?").run(id).changes > 0;
}
