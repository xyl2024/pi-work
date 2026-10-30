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
    }
    return false;
  }
}

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

export function readSessionPermissionModes(): Record<string, PermissionMode> {
  const out: Record<string, PermissionMode> = {};
  let entries: string[];
  try {
    entries = readdirSync(getDir());
  } catch {
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

export function permissionModeField(
  modes: Record<string, PermissionMode>,
  sessionId: string,
): { permissionMode?: PermissionMode } {
  const mode = modes[sessionId];
  return mode ? { permissionMode: mode } : {};
}

export function deleteSessionPermissionMode(sessionId: string): void {
  const id = safeIdOrNull(sessionId);
  if (id === null) return;
  try {
    unlinkSync(join(getDir(), `${id}.json`));
  } catch {
  }
}
