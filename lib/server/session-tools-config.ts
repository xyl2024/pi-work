// ============================================================================
// Session tool-selection sidecar index
//
// pi session JSONL files do not record which tools were active in a session,
// and the active subset lives only in the in-process AgentSessionWrapper.
// After a server restart the wrapper is gone, so re-opening a session used to
// fall back to "every registered tool" — which changes the system prompt and
// the tool definitions block and destroys the provider's prompt-cache hit
// rate for pre-existing conversations.
//
// To make the restore deterministic, every tool selection that goes live
// (session creation and `set_tools`) is mirrored to a per-session shadow
// file here:
//
//   ~/.pi-work/session-tools/<session-id>.json
//     →  {"selection":"all" | string[], "updatedAt":"..."}
//
// `startRpcSession` reads it back when re-opening an existing session file
// without an explicit tool selection, falling back to the cwd default
// (~/.pi-work/cwd-tools.json) for legacy sessions that never had one.
//
// Why ~/.pi-work/, not ~/.pi/agent/sidecars/:
//   - ~/.pi/ belongs to the SDK; the sidecar is Pi Work-specific metadata
//   - ~/.pi-work/ already houses session-names/, todos.db, config.yaml, etc.
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
import type { ToolSelection } from "../shared/types";

const SIDE_CAR_DIR_NAME = "session-tools";
// Same safety rule as session-names.ts: pi session ids look like
// `01a01ffa-023`, `<uuid>`, or short opaque tokens. Restrict the filename to
// a safe alphabet so a malformed id can never escape the sidecar dir.
const SAFE_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

function getSideCarDir(): string {
  return dataPath(SIDE_CAR_DIR_NAME);
}

function ensureSideCarDir(): string {
  const dir = getSideCarDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function safeIdOrNull(sessionId: string): string | null {
  if (typeof sessionId !== "string" || sessionId.length < 4) return null;
  return SAFE_ID_RE.test(sessionId) ? sessionId : null;
}

function normalizeSelection(value: unknown): ToolSelection | null {
  if (value === "all") return "all";
  if (!Array.isArray(value) || !value.every((name) => typeof name === "string")) return null;
  return Array.from(new Set(value as string[]));
}

/** Persist the tool selection that is live for a session. Best-effort. */
export function writeSessionToolSelection(sessionId: string, selection: unknown): boolean {
  const id = safeIdOrNull(sessionId);
  const normalized = normalizeSelection(selection);
  if (id === null || normalized === null) return false;
  try {
    const dir = ensureSideCarDir();
    const file = join(dir, `${id}.json`);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(
      temp,
      JSON.stringify({ selection: normalized, updatedAt: new Date().toISOString() }, null, 2) + "\n",
      "utf8",
    );
    renameSync(temp, file);
    return true;
  } catch {
    // Disk full / permission issues must never take down the agent session.
    return false;
  }
}

/** Remove the sidecar for a deleted session. No-op if absent. */
export function deleteSessionToolSelection(sessionId: string): void {
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
 * Read a session's persisted tool selection. Returns null on missing file,
 * malformed JSON, or unsafe id.
 */
export function readSessionToolSelection(sessionId: string): ToolSelection | null {
  const id = safeIdOrNull(sessionId);
  if (id === null) return null;
  try {
    const raw = readFileSync(join(getSideCarDir(), `${id}.json`), "utf8");
    const parsed = JSON.parse(raw) as { selection?: unknown };
    return normalizeSelection(parsed.selection);
  } catch {
    return null;
  }
}
