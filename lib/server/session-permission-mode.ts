// ============================================================================
// Per-session permission-mode sidecar
//
// A session's permission mode (ADR-0021) is per-session state that must survive
// a tab close and a server restart — "I authorize this session" cannot quietly
// expire just because the process was restarted. It has no home inside pi's
// session JSONL (that file belongs to the SDK; we only write entry types pi
// itself defines), so it lives in a sidecar here:
//
//   ~/.pi-work/session-permission-mode/<session-id>.json
//     →  {"mode":"confirm" | "full_access", "updatedAt":"..."}
//
// A missing file means `confirm`: that is what makes an upgrade invisible to
// every pre-existing session. An unreadable file, broken JSON or an illegal
// `mode` value all reduce to `confirm` too — a sidecar is never allowed to
// *grant* access by accident, and it is never allowed to stop a session from
// starting.
//
// Same shape as the session-names / session-tools / session-notify sidecars
// (atomic tmp+rename writes, safe-id filename restriction, the unified data
// root honouring PI_WORK_DATA_DIR). The duplication is deliberate for now;
// extracting one shared per-session sidecar module is a separate change.
// ============================================================================

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { dataPath } from "./data-dir";
import {
  DEFAULT_PERMISSION_MODE,
  isPermissionMode,
  type PermissionMode,
} from "../shared/permission-mode";

const DIR_NAME = "session-permission-mode";
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

function safeIdOrNull(sessionId: string): string | null {
  if (typeof sessionId !== "string" || sessionId.length < 4) return null;
  return SAFE_ID_RE.test(sessionId) ? sessionId : null;
}

/**
 * Persist a session's permission mode. Atomic write via tmp + rename, matching
 * the other sidecars. Returns false (never throws) when the id is unsafe or the
 * write fails: losing the file only means "back to confirm" after a restart,
 * which must not be able to break the session that is running right now.
 */
export function writeSessionPermissionMode(sessionId: string, mode: PermissionMode): boolean {
  const id = safeIdOrNull(sessionId);
  if (id === null || !isPermissionMode(mode)) return false;
  const dir = ensureDir();
  const target = join(dir, `${id}.json`);
  const tmp = join(dir, `${id}.json.${process.pid}.tmp`);
  const payload = JSON.stringify({ mode, updatedAt: new Date().toISOString() }, null, 2) + "\n";
  try {
    writeFileSync(tmp, payload, "utf8");
    renameSync(tmp, target);
    return true;
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore cleanup failures; the caller only cares that it did not land
    }
    return false;
  }
}

/**
 * Read a session's persisted permission mode.
 *
 * `confirm` on every non-answer: missing file, unsafe id, malformed JSON, or a
 * `mode` value that is not one of the two modes. The caller never has to tell
 * "never set" from "set to confirm" — both mean the same thing.
 */
export function readSessionPermissionMode(sessionId: string): PermissionMode {
  const id = safeIdOrNull(sessionId);
  if (id === null) return DEFAULT_PERMISSION_MODE;
  try {
    const raw = readFileSync(join(getDir(), `${id}.json`), "utf8");
    const parsed = JSON.parse(raw) as { mode?: unknown };
    return isPermissionMode(parsed.mode) ? parsed.mode : DEFAULT_PERMISSION_MODE;
  } catch {
    return DEFAULT_PERMISSION_MODE;
  }
}

/**
 * Every session that is in a non-default mode, as `{ sessionId → mode }`.
 *
 * The session list has to know this for the sidebar badge (a full-access
 * session must wear its shield even before the user opens it), and reading a
 * sidecar per listed session would mean hundreds of `readFileSync` calls per
 * list request. One directory listing plus one read per file that exists is
 * proportional to the number of *opted-in* sessions (typically zero), not to
 * the size of the session list.
 */
export function readSessionPermissionModes(): Record<string, PermissionMode> {
  const out: Record<string, PermissionMode> = {};
  let entries: string[];
  try {
    entries = readdirSync(getDir());
  } catch {
    // No directory yet: nobody ever opted in.
    return out;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const sessionId = entry.slice(0, -".json".length);
    if (safeIdOrNull(sessionId) === null) continue;
    const mode = readSessionPermissionMode(sessionId);
    if (mode !== DEFAULT_PERMISSION_MODE) out[sessionId] = mode;
  }
  return out;
}

/**
 * The `SessionInfo.permissionMode` field for one listed session — the
 * projection both session-list routes spread into their rows. Sessions the map
 * does not know about contribute nothing, because "absent" already means
 * `confirm` everywhere.
 */
export function permissionModeField(
  modes: Record<string, PermissionMode>,
  sessionId: string,
): { permissionMode?: PermissionMode } {
  const mode = modes[sessionId];
  return mode ? { permissionMode: mode } : {};
}

/** Remove the sidecar for a deleted session. No-op if absent. */
export function deleteSessionPermissionMode(sessionId: string): void {
  const id = safeIdOrNull(sessionId);
  if (id === null) return;
  try {
    unlinkSync(join(getDir(), `${id}.json`));
  } catch {
    // ENOENT or EACCES — both treated as benign.
  }
}
