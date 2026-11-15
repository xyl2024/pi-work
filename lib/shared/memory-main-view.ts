import { MEMORY_DIR_NAME, MEMORY_INDEX_FILE } from "./memory-two-tier";

export { MEMORY_DIR_NAME, MEMORY_INDEX_FILE };

export interface MemoryFileEntry {
  file: string;
  isIndex: boolean;
  mtime: string;
  description: string;
}

export interface MemoryFileListResponse {
  files: MemoryFileEntry[];
}

export interface MemoryFileReadResponse {
  content: string;
  mtime: string;
}

export function isAllowedMemoryFileName(name: string): boolean {
  if (name !== name.trim()) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.startsWith(".")) return false;
  if (!name.endsWith(".md")) return false;
  return name.length > ".md".length;
}

export function parseMemoryIndexDescriptions(indexContent: string): Record<string, string> {
  const descriptions: Record<string, string> = {};
  for (const line of indexContent.split("\n")) {
    const match = /^- (.+?) — (.*)$/.exec(line.trim());
    if (!match) continue;
    descriptions[match[1].trim()] = match[2].trim();
  }
  return descriptions;
}

export function removeMemoryIndexEntry(indexContent: string, file: string): string {
  const lines = indexContent.split("\n");
  const pattern = new RegExp(`^- ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} —(?: .*)?$`);
  const kept = lines.filter((line) => !pattern.test(line.trim()));
  return kept.join("\n");
}

export function orderMemoryFileNames(names: readonly string[]): string[] {
  return [...names].sort((a, b) => {
    if (a === MEMORY_INDEX_FILE) return -1;
    if (b === MEMORY_INDEX_FILE) return 1;
    return a.localeCompare(b);
  });
}
