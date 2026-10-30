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
import { migrateToolNames } from "../shared/subagent";

const SIDE_CAR_DIR_NAME = "session-tools";
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
  return migrateToolNames(value as string[]);
}

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
    return false;
  }
}

export function deleteSessionToolSelection(sessionId: string): void {
  const id = safeIdOrNull(sessionId);
  if (id === null) return;
  try {
    unlinkSync(join(getSideCarDir(), `${id}.json`));
  } catch {
  }
}

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
