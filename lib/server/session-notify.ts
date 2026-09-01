// ============================================================================
// Per-session notification channel sidecar
//
// The new-session page lets the user pick a messaging channel (WeChat) to
// receive that session's assistant replies. The binding is per-session and
// is stored as a small sidecar file here so it survives reloads and is
// isolated from every other session:
//
//   ~/.pi-work/session-notify/<session-id>.json   →   {"channelId":"...","updatedAt":"..."}
//
// `channelId` references a row in channels.db; the concrete WeChat recipient
// is resolved at send time from that channel row (so a channel re-scan / user
// change is always picked up). Old / un-configured sessions have no sidecar
// and never notify — zero breakage for anything else.
//
// Mirrors the session-names.ts sidecar pattern (atomic tmp+rename writes,
// safe-id filename restriction, ~/.pi-work data root).
// ============================================================================

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { dataPath } from "./data-dir";

export interface SessionNotifyConfig {
  /** Id of the messaging channel (channels.db) that gets this session's replies. */
  channelId: string;
  updatedAt: string;
}

const DIR_NAME = "session-notify";
// pi session ids look like `01a01ffa-023`, `<uuid>`, or short opaque tokens.
// Restrict the filename to a safe alphabet so a malformed id can never escape
// the sidecar dir (e.g. `../foo`).
const SAFE_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

function getDir(): string {
  return dataPath(DIR_NAME);
}

function ensureDir(): string {
  const dir = getDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Restrict sessionId to a safe filename stem. Returns null if disallowed. */
function safeIdOrNull(sessionId: string): string | null {
  return SAFE_ID_RE.test(sessionId) ? sessionId : null;
}

/**
 * Persist (or clear) a session's notification channel. Atomic write via
 * tmp + rename, matching session-names.ts. Pass an empty `channelId` to
 * clear — treated as "no notification".
 */
export function writeSessionNotify(sessionId: string, channelId: string): boolean {
  const id = safeIdOrNull(sessionId);
  if (id === null) return false;
  const trimmed = channelId.trim();
  if (!trimmed) {
    deleteSessionNotify(sessionId);
    return true;
  }
  const dir = ensureDir();
  const target = join(dir, `${id}.json`);
  const tmp = join(dir, `${id}.json.tmp.${Date.now()}`);
  const payload = JSON.stringify({ channelId: trimmed, updatedAt: new Date().toISOString() });
  try {
    writeFileSync(tmp, payload);
    renameSync(tmp, target);
    return true;
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore cleanup failures; preserve the original write error
    }
    throw error;
  }
}

/** Read a session's notification config. Returns null when not configured. */
export function readSessionNotify(sessionId: string): SessionNotifyConfig | null {
  const id = safeIdOrNull(sessionId);
  if (id === null) return null;
  try {
    const raw = readFileSync(join(getDir(), `${id}.json`), "utf8");
    const parsed = JSON.parse(raw) as { channelId?: unknown; updatedAt?: unknown };
    if (typeof parsed.channelId !== "string" || !parsed.channelId.trim()) return null;
    return {
      channelId: parsed.channelId.trim(),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}

/** Remove the sidecar for a deleted (or un-configured) session. No-op if absent. */
export function deleteSessionNotify(sessionId: string): void {
  const id = safeIdOrNull(sessionId);
  if (id === null) return;
  try {
    unlinkSync(join(getDir(), `${id}.json`));
  } catch {
    // ENOENT or EACCES — both treated as benign.
  }
}
