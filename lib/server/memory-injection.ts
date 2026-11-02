import { renderMemoryBlock } from "@/lib/shared/memory";
import { readMemory } from "./memory-store";

export function loadMemoryPromptBlock(enabled: boolean): string | null {
  if (!enabled) return null;
  const memory = readMemory("memory");
  const user = readMemory("user");
  if (memory.status === "unreadable" || user.status === "unreadable") return null;
  return renderMemoryBlock({ memory, user });
}
