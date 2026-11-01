import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataPath } from "./data-dir";
import {
  MAX_STORED_SUGGESTIONS,
  SUGGESTED_PROMPT_STORE_VERSION,
  parseStoredSuggestions,
  upsertStoredSuggestion,
  type StoredSuggestion,
} from "@/lib/shared/suggested-prompt";

const SIDE_CAR_DIR_NAME = "suggested-prompts";
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

export function readSuggestions(sessionId: string): StoredSuggestion[] {
  const id = safeIdOrNull(sessionId);
  if (id === null) return [];
  try {
    const raw = readFileSync(join(getSideCarDir(), `${id}.json`), "utf8");
    return parseStoredSuggestions(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeSuggestions(sessionId: string, items: readonly StoredSuggestion[]): boolean {
  const id = safeIdOrNull(sessionId);
  if (id === null) return false;
  const dir = ensureSideCarDir();
  const target = join(dir, `${id}.json`);
  const tmp = join(dir, `${id}.json.tmp.${Date.now()}`);
  try {
    writeFileSync(
      tmp,
      JSON.stringify({ version: SUGGESTED_PROMPT_STORE_VERSION, items }),
    );
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

export function storeSuggestion(sessionId: string, entry: StoredSuggestion): boolean {
  const next = upsertStoredSuggestion(readSuggestions(sessionId), entry, MAX_STORED_SUGGESTIONS);
  return writeSuggestions(sessionId, next);
}

export function deleteSuggestions(sessionId: string): void {
  const id = safeIdOrNull(sessionId);
  if (id === null) return;
  try {
    unlinkSync(join(getSideCarDir(), `${id}.json`));
  } catch {
  }
}
