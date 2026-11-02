import { renderMemoryBlock } from "@/lib/shared/memory";
import { createLogger } from "./logger";
import { isMemoryEnabledForCwd } from "./memory-cwd-store";
import { readMemory } from "./memory-store";

const log = createLogger("memory-injection");

export interface MemorySessionState {
  enabled: boolean;
  block: string | null;
}

export function loadMemoryPromptBlock(enabled: boolean): string | null {
  if (!enabled) return null;
  const memory = readMemory("memory");
  const user = readMemory("user");
  if (memory.status === "unreadable" || user.status === "unreadable") return null;
  return renderMemoryBlock({ memory, user });
}

export function resolveMemoryForSession(cwd: string, globalEnabled: boolean): MemorySessionState {
  let enabled: boolean;
  try {
    enabled = isMemoryEnabledForCwd(cwd, globalEnabled);
  } catch (error) {
    log.warn("memory cwd overrides unreadable; memory stays off for this session", { cwd, error });
    return { enabled: false, block: null };
  }
  return { enabled, block: loadMemoryPromptBlock(enabled) };
}
