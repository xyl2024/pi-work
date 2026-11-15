import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataPath } from "./data-dir";
import { writeFileAtomic } from "./atomic-write";
import { removeMemoryIndexEntry } from "@/lib/shared/memory-main-view";
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

export type MemoryWriteResult =
  | { status: "written"; mtime: string }
  | { status: "conflict"; content: string; mtime: string }
  | null;

export function writeMemoryFile(
  name: string,
  content: string,
  options: { openedMtime?: string; force?: boolean } = {},
): MemoryWriteResult {
  const filePath = memoryFilePath(name);
  if (filePath === null) return null;
  if (options.openedMtime !== undefined && options.force !== true) {
    const current = { mtime: statMtime(filePath) };
    if (current.mtime !== options.openedMtime) {
      return { status: "conflict", content: readFileSync(filePath, "utf8"), ...current };
    }
  }
  writeFileAtomic(filePath, content);
  return { status: "written", mtime: statMtime(filePath) };
}

export function createMemoryFile(name: string): "invalid" | "exists" | "index" | "created" {
  if (!isAllowedMemoryFileName(name)) return "invalid";
  if (name === MEMORY_INDEX_FILE) return "index";
  const filePath = memoryFilePath(name);
  if (filePath === null || existsSync(filePath)) return "exists";
  writeFileAtomic(filePath, "");
  return "created";
}

export function deleteMemoryFile(name: string): "invalid" | "index" | "missing" | "deleted" {
  if (!isAllowedMemoryFileName(name)) return "invalid";
  if (name === MEMORY_INDEX_FILE) return "index";
  const filePath = memoryFilePath(name);
  if (filePath === null || !existsSync(filePath)) return "missing";
  unlinkSync(filePath);
  const indexPath = join(memoryDir(), MEMORY_INDEX_FILE);
  try {
    const indexContent = readFileSync(indexPath, "utf8");
    const cleaned = removeMemoryIndexEntry(indexContent, name);
    if (cleaned !== indexContent) writeFileSync(indexPath, cleaned, "utf8");
  } catch {
  }
  return "deleted";
}
