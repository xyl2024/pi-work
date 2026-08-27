import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { dataPath } from "./data-dir";
import { TOOL_MARKET_IDS, type ToolMarketId } from "../shared/tools-market";

const CONFIG_PATH = join(dataPath(), "tools-market.json");
const DEFAULT_ENABLED = [...TOOL_MARKET_IDS];

function normalize(value: unknown): ToolMarketId[] {
  if (!Array.isArray(value)) return [...DEFAULT_ENABLED];
  const known = new Set(TOOL_MARKET_IDS);
  return value.filter((id, index, arr): id is ToolMarketId => typeof id === "string" && known.has(id as ToolMarketId) && arr.indexOf(id) === index);
}

export function readEnabledTools(): ToolMarketId[] {
  if (!existsSync(CONFIG_PATH)) return [...DEFAULT_ENABLED];
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as { enabled?: unknown };
    return normalize(parsed?.enabled);
  } catch {
    return [...DEFAULT_ENABLED];
  }
}

export function writeEnabledTools(enabled: unknown): ToolMarketId[] {
  const normalized = normalize(enabled);
  const dir = dataPath();
  mkdirSync(dir, { recursive: true });
  const temp = `${CONFIG_PATH}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ enabled: normalized }, null, 2) + "\n", "utf8");
  renameSync(temp, CONFIG_PATH);
  return normalized;
}
