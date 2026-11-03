export type MemoryTarget = "memory" | "user";

export const MEMORY_TARGETS: readonly MemoryTarget[] = ["memory", "user"];

export const MEMORY_TARGET_TITLE_KEYS: Record<MemoryTarget, string> = {
  memory: "Agent notes",
  user: "User profile",
};

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

export interface MemoryLibrarySnapshot {
  hash: string;
  entryCount: number;
  entryHashes: readonly string[];
}

export interface SessionMemorySnapshot {
  capturedAt: number;
  memory: MemoryLibrarySnapshot | null;
  user: MemoryLibrarySnapshot | null;
}

export function injectedMemoryEntries(entries: readonly string[]): string[] {
  return entries.filter((entry) => entry.trim().length > 0);
}

export function memoryLibraryHash(entryHashes: readonly string[]): string {
  return memoryEntryHash(entryHashes.join(""));
}

export function memoryLibrarySnapshot(entries: readonly string[]): MemoryLibrarySnapshot | null {
  const injected = injectedMemoryEntries(entries);
  if (injected.length === 0) return null;
  const entryHashes = injected.map((text) => memoryEntryHash(text));
  return {
    hash: memoryLibraryHash(entryHashes),
    entryCount: injected.length,
    entryHashes,
  };
}

export function memorySnapshotChanges(
  snapshot: MemoryLibrarySnapshot,
  entries: readonly Pick<MemoryEntryView, "text" | "hash">[],
): number {
  const counts = new Map<string, number>();
  for (const hash of snapshot.entryHashes) {
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
  }
  let added = 0;
  for (const entry of entries) {
    if (entry.text.trim().length === 0) continue;
    const remaining = counts.get(entry.hash) ?? 0;
    if (remaining === 0) added += 1;
    else counts.set(entry.hash, remaining - 1);
  }
  let removed = 0;
  for (const remaining of counts.values()) removed += remaining;
  return added + removed;
}

export function memoryEntriesUsage(entries: readonly string[]): number {
  return entries.join(MEMORY_ENTRY_SEPARATOR).length;
}

export interface MemorySnapshotDifference {
  capturedAt: number;
  changed: number;
}

export function memorySnapshotDifference(
  snapshot: SessionMemorySnapshot | null,
  current: MemoryLibrariesView | null,
): MemorySnapshotDifference | null {
  if (snapshot === null || current === null) return null;
  let changed = 0;
  for (const target of MEMORY_TARGETS) {
    const view = current[target];
    if (view.status === "unreadable") return null;
    const library = snapshot[target];
    if (library === null) {
      changed += view.entries.filter((entry) => entry.text.trim().length > 0).length;
      continue;
    }
    if (library.hash === view.hash) continue;
    changed += memorySnapshotChanges(library, view.entries);
  }
  return { capturedAt: snapshot.capturedAt, changed };
}

export function formatMemorySnapshotTime(capturedAt: number): string {
  const at = new Date(capturedAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
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
  hash: string;
  used: number;
  limit: number;
}

export function memoryLibraryView(source: MemoryLibrarySource): MemoryLibraryView {
  const entries = memoryEntryViews(source.entries, source.limit);
  return {
    target: source.target,
    file: MEMORY_TARGET_FILES[source.target],
    status: source.status,
    entries,
    hash: memoryLibraryHash(
      entries.filter((entry) => entry.text.trim().length > 0).map((entry) => entry.hash),
    ),
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
  const entries = injectedMemoryEntries(usage.entries);
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

export interface MemoryLibrariesView {
  memory: MemoryLibraryView;
  user: MemoryLibraryView;
}

export interface MemoryEntriesResponse extends MemoryLibrariesView {
  enabled: boolean;
}

export type MemoryLibraryState = "entries" | "empty" | "unreadable";

export function memoryLibraryState(
  view: Pick<MemoryLibraryView, "status" | "entries">,
): MemoryLibraryState {
  if (view.status === "unreadable") return "unreadable";
  return view.entries.length > 0 ? "entries" : "empty";
}
