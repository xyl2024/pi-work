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

export interface MemoryEntryView {
  index: number;
  text: string;
  length: number;
  oversized: boolean;
  hash: string;
}

const ENTRY_HASH_SEEDS = [0x811c9dc5, 0x9e3779b9] as const;

function foldCodeUnits(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

export function memoryEntryHash(text: string): string {
  return ENTRY_HASH_SEEDS.map((seed) =>
    foldCodeUnits(text, seed).toString(16).padStart(8, "0"),
  ).join("");
}

export function memoryEntryViews(entries: readonly string[], limit: number): MemoryEntryView[] {
  return entries.map((text, index) => ({
    index,
    text,
    length: text.length,
    oversized: text.length > limit,
    hash: memoryEntryHash(text),
  }));
}

export function memoryEntriesUsage(entries: readonly string[]): number {
  return entries.join(MEMORY_ENTRY_SEPARATOR).length;
}

export interface MemoryUsage {
  entries: readonly string[];
  used: number;
  limit: number;
}

export type MemoryStoreStatus = "ok" | "missing" | "unreadable";

export interface MemoryStoreUsage {
  file: string;
  status: MemoryStoreStatus;
  used: number;
  limit: number;
}

export type MemoryUsageReport = Record<MemoryTarget, MemoryStoreUsage>;

export interface MemoryUsageByTarget {
  memory: MemoryUsage;
  user: MemoryUsage;
}

export interface MemoryLibrarySource {
  target: MemoryTarget;
  status: MemoryStoreStatus;
  entries: readonly string[];
  limit: number;
}

export interface MemoryLibraryView {
  target: MemoryTarget;
  file: string;
  status: MemoryStoreStatus;
  entries: MemoryEntryView[];
  used: number;
  limit: number;
}

export function memoryLibraryView(source: MemoryLibrarySource): MemoryLibraryView {
  return {
    target: source.target,
    file: MEMORY_TARGET_FILES[source.target],
    status: source.status,
    entries: memoryEntryViews(source.entries, source.limit),
    used: memoryEntriesUsage(source.entries),
    limit: source.limit,
  };
}

export function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatMemoryCharCounts(used: number, limit: number): string {
  return `${groupDigits(used)}/${groupDigits(limit)}`;
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
