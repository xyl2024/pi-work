import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MEMORY_DIR_NAME,
  MEMORY_INDEX_FILE,
  renderMemoryInjection,
} from "@/lib/shared/memory-two-tier";
import type { SessionMemorySnapshot } from "@/lib/shared/memory";
import { createLogger } from "./logger";
import { isMemoryEnabledForCwd } from "./memory-cwd-store";
import { dataPath } from "./data-dir";

const log = createLogger("memory-injection");

export interface MemorySessionInjection {
  enabled: boolean;
  block: string | null;
  snapshot: SessionMemorySnapshot | null;
}

export function memoryIndexPath(): string {
  return join(dataPath(MEMORY_DIR_NAME), MEMORY_INDEX_FILE);
}

function readIndexContent(): string | null {
  const path = memoryIndexPath();
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    log.warn("memory index unreadable; no memory block for this session", { path, error });
    return null;
  }
}

function loadMemoryBlock(enabled: boolean): string | null {
  if (!enabled) return null;
  const indexContent = readIndexContent();
  if (indexContent === null) return null;
  return renderMemoryInjection(indexContent);
}

export function loadMemoryPromptBlock(enabled: boolean): string | null {
  return loadMemoryBlock(enabled);
}

export function resolveMemoryInjectionForSession(
  cwd: string,
  globalEnabled: boolean,
): MemorySessionInjection {
  let enabled: boolean;
  try {
    enabled = isMemoryEnabledForCwd(cwd, globalEnabled);
  } catch (error) {
    log.warn("memory cwd overrides unreadable; memory stays off for this session", { cwd, error });
    return { enabled: false, block: null, snapshot: null };
  }
  return { enabled, block: loadMemoryBlock(enabled), snapshot: null };
}
