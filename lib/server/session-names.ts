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
import { dataPath } from "./data-dir";

export interface SessionNameEntry {
  name: string;
  updatedAt: string;
}

const SIDE_CAR_DIR_NAME = "session-names";
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
  return SAFE_ID_RE.test(sessionId) ? sessionId : null;
}

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
    }
    throw error;
  }
}

export function deleteSessionName(sessionId: string): void {
  const id = safeIdOrNull(sessionId);
  if (id === null) return;
  try {
    unlinkSync(join(getSideCarDir(), `${id}.json`));
  } catch {
  }
}

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
    if (!SAFE_ID_RE.test(id)) continue;
    tasks.push(readSessionNameAsync(id, join(getSideCarDir(), file)));
  }
  const results = await Promise.all(tasks);
  for (const r of results) {
    if (r) out.set(r[0], r[1]);
  }
  return out;
}
