import {
  memoryLibrarySnapshot,
  renderMemoryBlock,
  type SessionMemorySnapshot,
} from "@/lib/shared/memory";
import { createLogger } from "./logger";
import { isMemoryEnabledForCwd } from "./memory-cwd-store";
import { readMemory } from "./memory-store";

const log = createLogger("memory-injection");

export interface MemorySessionState {
  enabled: boolean;
  block: string | null;
}

export interface MemorySessionInjection extends MemorySessionState {
  snapshot: SessionMemorySnapshot | null;
}

function loadMemoryInjection(enabled: boolean): { block: string | null; snapshot: SessionMemorySnapshot | null } {
  if (!enabled) return { block: null, snapshot: null };
  const memory = readMemory("memory");
  const user = readMemory("user");
  if (memory.status === "unreadable" || user.status === "unreadable") {
    return { block: null, snapshot: null };
  }
  const block = renderMemoryBlock({ memory, user });
  if (block === null) return { block: null, snapshot: null };
  return {
    block,
    snapshot: {
      memory: memoryLibrarySnapshot(memory.entries),
      user: memoryLibrarySnapshot(user.entries),
    },
  };
}

export function loadMemoryPromptBlock(enabled: boolean): string | null {
  return loadMemoryInjection(enabled).block;
}

export function resolveMemoryForSession(cwd: string, globalEnabled: boolean): MemorySessionState {
  const injection = resolveMemoryInjectionForSession(cwd, globalEnabled);
  return { enabled: injection.enabled, block: injection.block };
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
  return { enabled, ...loadMemoryInjection(enabled) };
}
