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
  channelId: string;
  updatedAt: string;
}

const DIR_NAME = "session-notify";
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
  return SAFE_ID_RE.test(sessionId) ? sessionId : null;
}

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
    }
    throw error;
  }
}

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

export function deleteSessionNotify(sessionId: string): void {
  const id = safeIdOrNull(sessionId);
  if (id === null) return;
  try {
    unlinkSync(join(getDir(), `${id}.json`));
  } catch {
  }
}
