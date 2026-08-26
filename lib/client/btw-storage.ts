// ── BTW (By the way) localStorage layer ────────────────────────────────
//
// BTW is a sidebar panel that asks a temporary, in-memory, read-only-only
// agent grounded in the active session's context. Per the handoff (§1, §2,
// §7), BTW must NOT touch the main session's JSONL, the RPC registry, or
// any server-side store. The browser-localStorage is its only durable
// home.
//
// Per the handoff §3.3:
//   - key: `pi-work:btw:<mainSessionId>` — one entry per main session
//   - 2 MB ceiling per key — bump up to the user instead of silently
//     dropping messages
//   - 7-day silent expiry — `lastUpdated` older than 7d → drop on entry
//   - manual clear needs a second user confirmation; auto-expiry is silent
//
// The shape is intentionally small and string-only (no Blob / Date /
// Symbol). JSON.stringify + JSON.parse covers both directions; the only
// versioned field is `version: 1` so a future bump can migrate without a
// lost-history moment for users who keep their tabs open across deploys.

import type { AgentMessage } from "@/lib/shared/types";

const BTW_STORAGE_PREFIX = "pi-work:btw:";
const BTW_STORAGE_VERSION = 1 as const;
const BTW_MAX_KEY_BYTES = 2 * 1024 * 1024; // 2 MB hard cap per session key
const BTW_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface BtwPersisted {
  version: typeof BTW_STORAGE_VERSION;
  mainSessionId: string;
  /** Snapshot of the provider/model used at record creation. Dropped by
   *  the pure-chat switch (the server re-reads the live model on every
   *  send); kept optional so legacy records continue to validate. */
  modelSnapshot?: { provider: string; modelId: string };
  createdAt: number;
  /** Epoch ms of the latest committed user/assistant write. Drives §3.3
   *  7-day expiry — if (now - lastUpdated) > 7d the whole record is
   *  dropped on entry. */
  lastUpdated: number;
  /** Owns only the BTW messages. The first send snapshots the main
   *  session's full context into a `UserMessage` payload (see
   *  `useBtw.ts`); the messages array on disk starts after the assistant
   *  has answered the opening turn. */
  messages: AgentMessage[];
}

export class BtwStorageQuotaError extends Error {
  /** Attempted UTF-16 byte length of the JSON.stringify output. */
  readonly attemptedBytes: number;
  constructor(attemptedBytes: number) {
    super(
      `BTW history exceeds the ${BTW_MAX_KEY_BYTES} byte cap (attempted ${attemptedBytes} bytes); please clear the conversation.`,
    );
    this.name = "BtwStorageQuotaError";
    this.attemptedBytes = attemptedBytes;
  }
}

function keyFor(mainSessionId: string): string {
  return BTW_STORAGE_PREFIX + mainSessionId;
}

/** Test/storage isolation hook — every helper funnels reads/writes through
 *  this indirection so tests (or future Storage backends) can override it
 *  without rewriting the public API. Falls back to localStorage. */
function getStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** String-byte length (UTF-16). 2 MB is measured by JSON.stringify output,
 *  not the parsed object, so we use byte length of the JSON string here
 *  for an apples-to-apples comparison. */
function utf16ByteLength(value: string): number {
  return value.length * 2;
}

/** Read the persisted BTW record for `mainSessionId`. Returns `null`
 *  when:
 *    - localStorage is unavailable
 *    - the key is missing
 *    - the stored value is corrupt JSON (treated as fresh start)
 *    - the stored value's `version` is not the current version
 *  Applies §3.3 expiry inline: if (now - lastUpdated) > 7d, the entry is
 *  deleted and `null` is returned. Expiry is silent — the user does NOT
 *  see a toast. */
export function readBtw(mainSessionId: string): BtwPersisted | null {
  const store = getStore();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(keyFor(mainSessionId));
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt JSON — nuke the bad entry rather than keep retrying.
    try { store.removeItem(keyFor(mainSessionId)); } catch { /* ignore */ }
    return null;
  }
  if (!isBtwPersisted(parsed) || parsed.version !== BTW_STORAGE_VERSION) {
    // Wrong version / unexpected shape — drop it. Future migrations land
    // here when the version is bumped.
    try { store.removeItem(keyFor(mainSessionId)); } catch { /* ignore */ }
    return null;
  }
  // 7-day silent expiry (§3.3)
  if (Date.now() - parsed.lastUpdated > BTW_EXPIRY_MS) {
    try { store.removeItem(keyFor(mainSessionId)); } catch { /* ignore */ }
    return null;
  }
  return parsed;
}

/** Persist `next`. Throws `BtwStorageQuotaError` when the serialized
 *  payload exceeds the 2 MB cap (per handoff §3.3, the user must clear
 *  instead of silently dropping messages). All other write failures
 *  (private mode, etc.) are swallowed — BTW is best-effort persistence
 *  and a transient write failure should not crash the panel. */
export function writeBtw(next: BtwPersisted): void {
  const store = getStore();
  if (!store) return;
  let raw: string;
  try {
    raw = JSON.stringify(next);
  } catch (stringifyError) {
    console.warn("[btw-storage] failed to serialise BTW record", stringifyError);
    return;
  }
  const bytes = utf16ByteLength(raw);
  if (bytes > BTW_MAX_KEY_BYTES) {
    throw new BtwStorageQuotaError(bytes);
  }
  try {
    store.setItem(keyFor(next.mainSessionId), raw);
  } catch (error) {
    // QuotaExceededError, SecurityError (private mode), etc.
    // Best-effort: never crash the panel for a write failure.
    if (typeof console !== "undefined") {
      console.warn("[btw-storage] write failed", error);
    }
  }
}

/** Drop the BTW record for `mainSessionId`. No-op when the key is absent
 *  or storage is unavailable. Used by manual "clear" and by the main
 *  session delete handler (per handoff §2 #25). */
export function deleteBtw(mainSessionId: string): void {
  const store = getStore();
  if (!store) return;
  try {
    store.removeItem(keyFor(mainSessionId));
  } catch {
    // ignore
  }
}

/** True iff a record exists for `mainSessionId` (after applying the
 *  7-day expiry). Used by useBtw to decide whether the next send is the
 *  "first" one (full main-session context) or a continuation (BTW's own
 *  messages only). */
export function hasBtw(mainSessionId: string): boolean {
  return readBtw(mainSessionId) !== null;
}

/** Shape guard. Narrow-but-deliberate — anything that doesn't match is
 *  treated as corrupt and dropped. */
function isBtwPersisted(value: unknown): value is BtwPersisted {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.mainSessionId !== "string") return false;
  if (typeof v.createdAt !== "number" || !Number.isFinite(v.createdAt)) return false;
  if (typeof v.lastUpdated !== "number" || !Number.isFinite(v.lastUpdated)) return false;
  if ("modelSnapshot" in v) {
    if (!v.modelSnapshot || typeof v.modelSnapshot !== "object") return false;
    const ms = v.modelSnapshot as Record<string, unknown>;
    if (typeof ms.provider !== "string" || typeof ms.modelId !== "string") return false;
  }
  if (!Array.isArray(v.messages)) return false;
  return true;
}