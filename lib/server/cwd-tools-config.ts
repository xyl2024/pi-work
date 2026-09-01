import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { dataPath } from "./data-dir";
import type { ToolSelection } from "../shared/types";

const CONFIG_PATH = join(dataPath(), "cwd-tools.json");
type StoredConfig = Record<string, ToolSelection>;

function normalizeSelection(value: unknown): ToolSelection | null {
  if (value === "all") return "all";
  if (!Array.isArray(value) || !value.every((name) => typeof name === "string")) return null;
  return Array.from(new Set(value as string[]));
}

function readConfig(): StoredConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: StoredConfig = {};
    for (const [cwd, selection] of Object.entries(parsed)) {
      const normalized = normalizeSelection(selection);
      if (normalized !== null) result[cwd] = normalized;
    }
    return result;
  } catch {
    return {};
  }
}

export function readCwdToolSelection(cwd: string): ToolSelection | null {
  return readConfig()[cwd] ?? null;
}

export function writeCwdToolSelection(cwd: string, selection: unknown): ToolSelection {
  const normalized = normalizeSelection(selection);
  if (normalized === null) throw new Error("selection must be 'all' or an array of tool names");
  const config = readConfig();
  config[cwd] = normalized;
  mkdirSync(dataPath(), { recursive: true });
  const temp = `${CONFIG_PATH}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", "utf8");
  renameSync(temp, CONFIG_PATH);
  return normalized;
}
