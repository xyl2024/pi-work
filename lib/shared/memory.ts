export type MemoryTarget = "memory" | "user";

const MEMORY_TARGETS: readonly MemoryTarget[] = ["memory", "user"];

export const MEMORY_TARGET_FILES: Record<MemoryTarget, string> = {
  memory: "MEMORY.md",
  user: "USER.md",
};

export const MEMORY_ENTRY_SEPARATOR = "\n§\n";

const MEMORY_BLOCK_TITLES: Record<MemoryTarget, string> = {
  memory: "MEMORY (your personal notes)",
  user: "USER PROFILE (who the user is)",
};

const MEMORY_BLOCK_RULE = "═".repeat(46);

export interface MemoryUsage {
  entries: readonly string[];
  used: number;
  limit: number;
}

export interface MemoryUsageByTarget {
  memory: MemoryUsage;
  user: MemoryUsage;
}

function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatMemoryUsage(usage: Pick<MemoryUsage, "used" | "limit">): string {
  const percent = usage.limit > 0 ? Math.round((usage.used / usage.limit) * 100) : 0;
  return `[${percent}% — ${groupDigits(usage.used)}/${groupDigits(usage.limit)} chars]`;
}

function renderMemorySection(target: MemoryTarget, usage: MemoryUsage): string | null {
  const entries = usage.entries.filter((entry) => entry.trim().length > 0);
  if (entries.length === 0) return null;
  return [
    MEMORY_BLOCK_RULE,
    `${MEMORY_BLOCK_TITLES[target]} ${formatMemoryUsage(usage)}`,
    MEMORY_BLOCK_RULE,
    entries.join(MEMORY_ENTRY_SEPARATOR),
  ].join("\n");
}

export function renderMemoryBlock(usages: MemoryUsageByTarget): string | null {
  const sections = MEMORY_TARGETS.map((target) => renderMemorySection(target, usages[target])).filter(
    (section): section is string => section !== null,
  );
  if (sections.length === 0) return null;
  return sections.join("\n\n");
}
