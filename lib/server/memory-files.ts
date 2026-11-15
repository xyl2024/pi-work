import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { dataPath } from "./data-dir";
import { writeFileAtomic } from "./atomic-write";
import { isAllowedMemoryFileName, MEMORY_INDEX_FILE, orderMemoryFileNames, parseMemoryIndexDescriptions } from "@/lib/shared/memory-main-view";

export function memoryDir(): string {
  return dataPath("memory");
}

function memoryFilePath(name: string): string | null {
  if (!isAllowedMemoryFileName(name)) return null;
  return join(memoryDir(), name);
}

export function isValidMemoryFileName(name: string): boolean {
  return isAllowedMemoryFileName(name);
}

function statMtime(filePath: string): string {
  return statSync(filePath).mtime.toISOString();
}

function indexDescriptions(): Record<string, string> {
  try {
    return parseMemoryIndexDescriptions(readFileSync(join(memoryDir(), MEMORY_INDEX_FILE), "utf8"));
  } catch {
    return {};
  }
}

export function listMemoryFiles() {
  const names = readdirSync(memoryDir()).filter((name) => isAllowedMemoryFileName(name));
  const descriptions = indexDescriptions();
  return orderMemoryFileNames(names).map((file) => ({
    file,
    isIndex: file === MEMORY_INDEX_FILE,
    mtime: statMtime(join(memoryDir(), file)),
    description: descriptions[file] ?? "",
  }));
}

export function readMemoryFile(name: string): { content: string; mtime: string } | null {
  const filePath = join(memoryDir(), name);
  try {
    return { content: readFileSync(filePath, "utf8"), mtime: statMtime(filePath) };
  } catch {
    return null;
  }
}

export function writeMemoryFile(name: string, content: string): { mtime: string } | null {
  const filePath = memoryFilePath(name);
  if (filePath === null) return null;
  writeFileAtomic(filePath, content);
  return { mtime: statMtime(filePath) };
}
