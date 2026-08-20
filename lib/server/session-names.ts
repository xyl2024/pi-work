// ============================================================================
// Session name sidecar index
//
// The sidebar renders `session.name || session.firstMessage.slice(0,50) || id`,
// and pi SDK's session_info-driven `getSessionName()` requires a full JSONL
// scan to find the latest match (because each `setSessionName()` call appends
// a new `session_info` entry, so the "latest" name can be arbitrarily far
// into the file). For /api/sessions we only read each file's first 16 KB,
// which intentionally drops the latest name for sessions where the rename
// landed past that window — the sidebar then falls back to firstMessage.
//
// To get 100% name recall without re-introducing the multi-second full scan,
// every `setSessionName` event also writes a per-session shadow file here:
//
//   ~/.pi-work/session-names/<session-id>.json   →   {"name":"...","updatedAt":"..."}
//
// `listAllSessionsHeaderOnly` reads this index in parallel with the disk
// scan and prefers the sidecar value over the bounded window read. Old /
// un-renamed sessions have no sidecar and keep the existing firstMessage
// fallback — zero breakage for callers.
//
// Why ~/.pi-work/, not ~/.pi/agent/sidecars/:
//   - ~/.pi/ belongs to the SDK; sidecar is a Pi Work-specific metadata
//   - ~/.pi-work/ already houses todos.db, config.yaml, etc., so the path
//     mirrors the project's existing data root
// ============================================================================

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface SessionNameEntry {
  name: string;
  updatedAt: string;
}

const SIDE_CAR_DIR_NAME = "session-names";
// pi session ids look like `01a01ffa-023`, `<uuid>`, or short opaque tokens.
// Restrict the filename to a safe alphabet so a malicious / malformed id can
// never escape the sidecar dir (e.g. `../foo`).
const SAFE_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

function getSideCarDir(): string {
  return join(homedir(), ".pi-work", SIDE_CAR_DIR_NAME);
}

function ensureSideCarDir(): string {
  const dir = getSideCarDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Restrict sessionId to a safe filename stem. Returns null if disallowed. */
function safeIdOrNull(sessionId: string): string | null {
  return SAFE_ID_RE.test(sessionId) ? sessionId : null;
}

/**
 * Persist the latest known display name for a session. Atomic write:
 * write to `<id>.json.tmp.<ts>` first, then `renameSync` to the real
 * filename. A crash mid-write leaves the previous sidecar (or no file)
 * intact; the `.tmp` is harmless garbage that future reads simply skip
 * (matching the agent-settings.ts write pattern).
 *
 * Empty / whitespace-only names are treated as "clear" — caller should
 * invoke `deleteSessionName` instead. We deliberately don't write the
 * empty file: `getSessionName` semantics already treat blank names as
 * "no name set", and silently writing one would make `readSessionName`
 * return `""` instead of `null`.
 */
export function writeSessionName(sessionId: string, name: string): boolean {
  const id = safeIdOrNull(sessionId);
  if (id === null) return false;
  const trimmed = name.replace(/[\r\n]+/g, " ").trim();
  if (!trimmed) return false;
  const dir = ensureSideCarDir();
  const target = join(dir, `${id}.json`);
  const tmp = join(dir, `${id}.json.tmp.${Date.now()}`);
  const payload = JSON.stringify({
    name: trimmed,
    updatedAt: new Date().toISOString(),
  });
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

/** Remove the sidecar for a deleted (or un-named) session. No-op if absent. */
export function deleteSessionName(sessionId: string): void {
  const id = safeIdOrNull(sessionId);
  if (id === null) return;
  try {
    unlinkSync(join(getSideCarDir(), `${id}.json`));
  } catch {
    // ENOENT or EACCES — both treated as benign; the caller doesn't
    // care whether the sidecar existed.
  }
}

/**
 * Read a single session's sidecar entry. Returns null on missing file,
 * malformed JSON, blank name, or unsafe id. Synchronous — used by the
 * `migrate-session-names.ts` backfill script and anywhere a single
 * lookup needs to stay off the await queue (the index file is tiny,
 * sub-millisecond once the page cache is warm).
 */
export function readSessionName(sessionId: string): SessionNameEntry | null {
  const id = safeIdOrNull(sessionId);
  if (id === null) return null;
  try {
    const raw = readFileSync(join(getSideCarDir(), `${id}.json`), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown; updatedAt?: unknown };
    if (typeof parsed.name !== "string") return null;
    const name = parsed.name.trim();
    if (!name) return null;
    const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : "";
    return { name, updatedAt };
  } catch {
    return null;
  }
}

/**
 * Async variant of `readSessionName` for the bulk reader. Uses the same
 * parsing rules; reads via fs/promises so it can run concurrently.
 */
async function readSessionNameAsync(
  id: string,
  filePath: string,
): Promise<[string, SessionNameEntry] | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown; updatedAt?: unknown };
    if (typeof parsed.name !== "string") return null;
    const name = parsed.name.trim();
    if (!name) return null;
    const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : "";
    return [id, { name, updatedAt }];
  } catch {
    return null;
  }
}

/**
 * Read every sidecar entry. Used by `listAllSessionsHeaderOnly` as the
 * parallel "name lookup" path while it scans the main JSONL directory.
 *
 * Async + concurrent via fs/promises: on hosts with ~1600+ sidecars
 * (matching the session-file count) the sync version blocked the event
 * loop for the entire directory read. The libuv thread pool handles
 * backpressure internally, so we just fan out a Promise.all and let
 * fspromise / libuv pipeline the reads.
 */
export async function listSessionNames(): Promise<Map<string, SessionNameEntry>> {
  const out = new Map<string, SessionNameEntry>();
  let entries: string[];
  try {
    entries = await readdir(getSideCarDir());
  } catch {
    return out;
  }
  const tasks: Promise<[string, SessionNameEntry] | null>[] = [];
  for (const file of entries) {
    if (!file.endsWith(".json") || file.includes(".tmp.")) continue;
    const id = file.slice(0, -".json".length);
    if (!SAFE_ID_RE.test(id)) continue; // defensive: skip stray / unsafe names
    tasks.push(readSessionNameAsync(id, join(getSideCarDir(), file)));
  }
  const results = await Promise.all(tasks);
  for (const r of results) {
    if (r) out.set(r[0], r[1]);
  }
  return out;
}
