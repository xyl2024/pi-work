import { renderMemoryBlock } from "@/lib/shared/memory";
import { isMemoryEnabledForCwd } from "./memory-cwd-store";
import { readMemory } from "./memory-store";

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
  const enabled = isMemoryEnabledForCwd(cwd, globalEnabled);
  return { enabled, block: loadMemoryPromptBlock(enabled) };
}
