import type { MemoryTarget } from "./memory";

export const MEMORY_TOOL_NAME = "memory";

export interface MemoryToolDetails {
  ok: boolean;
  target: MemoryTarget;
  entryCount: number;
  used: number;
  limit: number;
  code?: string;
}
