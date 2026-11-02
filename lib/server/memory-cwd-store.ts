import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dataPath } from "./data-dir";

const FILE_NAME = "memory-cwd.json";

export type MemoryCwdOverrides = Record<string, false>;

function overridesPath(): string {
  return dataPath(FILE_NAME);
}

export function readMemoryCwdOverrides(): MemoryCwdOverrides {
  const path = overridesPath();
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${FILE_NAME} must contain a cwd-keyed object`);
  }
  const overrides: MemoryCwdOverrides = {};
  for (const [cwd, value] of Object.entries(parsed)) {
    if (value === false) overrides[cwd] = false;
  }
  return overrides;
}

export function isMemoryEnabledForCwd(cwd: string, globalEnabled: boolean): boolean {
  if (!globalEnabled) return false;
  return readMemoryCwdOverrides()[cwd] !== false;
}

export function writeMemoryCwdEnabled(cwd: string, enabled: boolean): MemoryCwdOverrides {
  const overrides = readMemoryCwdOverrides();
  if (enabled) {
    delete overrides[cwd];
  } else {
    overrides[cwd] = false;
  }
  const path = overridesPath();
  mkdirSync(dataPath(), { recursive: true });
  if (Object.keys(overrides).length === 0) {
    try {
      unlinkSync(path);
    } catch {
    }
    return overrides;
  }
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(overrides, null, 2) + "\n", "utf8");
  renameSync(temp, path);
  return overrides;
}
