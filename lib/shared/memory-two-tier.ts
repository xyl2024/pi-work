import { MEMORY_ENTRY_SEPARATOR } from "./memory";

export const MEMORY_DIR_NAME = "memory";
export const MEMORY_INDEX_FILE = "INDEX.md";
export const MEMORY_INDEX_BUDGET = 2000;
export const MEMORY_ARCHIVE_SUFFIX = ".bak";

export const MEMORY_INDEX_HEADING = "Current memory index:";

export function renderMemoryGuidance(memoryDir: string): string {
  return [
    "Memory management guidelines:",
    `- User memory is stored as two-level Markdown files in the memory data directory ${memoryDir}, divided into an index file and detail files.`,
    `  - Index: ${memoryDir}/${MEMORY_INDEX_FILE}.`,
    `  - Details: ${memoryDir}/<slug>.md, with details stored by category and read/written using read / write / edit / bash.`,
    "",
    "Conventions:",
    "1. Write new facts into the corresponding detail file; if there is no suitable category, create a new file with a lowercase hyphenated filename in the detail directory above.",
    "2. After writing the details, update the index accordingly: one line per existing category (absolute path + one-sentence description), and maintain a summary of user preferences.",
    `3. Keep the index within ${MEMORY_INDEX_BUDGET} characters: include only category directories and high-value summaries; all details must go into detail files.`,
    "4. When reading memory, first look at the index to locate the category, then read the corresponding details as needed; do not read everything in full.",
    "5. Memory is global and unrelated to the current working directory; do not write project-specific information into memory.",
  ].join("\n");
}

export function renderMemoryEmptyState(memoryDir: string): string {
  return [
    "The current index is empty: there is no memory yet.",
    `Create files lazily on demand: only create ${memoryDir}/${MEMORY_INDEX_FILE} and the corresponding detail files when a new fact is learned,`,
    "never pre-create files in bulk and never write placeholder content when there is no fact.",
  ].join(" ");
}

export interface MemoryIndexCategory {
  file: string;
  description: string;
}

export function renderMemoryIndex(categories: readonly MemoryIndexCategory[]): string {
  const lines = [
    "# 记忆索引",
    "",
    "## 分类目录",
  ];
  if (categories.length === 0) {
    lines.push("（暂无分类）");
  } else {
    for (const category of categories) {
      lines.push(`- ${category.file} — ${category.description}`);
    }
  }
  lines.push("", "## 用户偏好摘要", "（待整理：阅读明细文件后把高价值要点写入此处）");
  return lines.join("\n");
}

export function renderMemoryInjection(indexContent: string, memoryDir: string): string {
  const trimmed = indexContent.trim();
  const body =
    trimmed.length === 0
      ? `${renderMemoryGuidance(memoryDir)}\n\n${renderMemoryEmptyState(memoryDir)}`
      : `${renderMemoryGuidance(memoryDir)}\n\n${MEMORY_INDEX_HEADING}\n${trimmed}`;
  return `<memory>\n${body}\n</memory>`;
}

const MIGRATED_CATEGORIES = {
  memory: {
    file: "agent-notes.md",
    description: "Agent 笔记（自旧 MEMORY.md 迁移）",
  },
  user: {
    file: "user-profile.md",
    description: "用户资料（自旧 USER.md 迁移）",
  },
} as const;

export interface MemoryMigrationFile {
  path: string;
  content: string;
}

export interface MemoryMigrationArchive {
  from: string;
  to: string;
}

export interface MemoryMigrationInput {
  memoryRaw: string | null;
  userRaw: string | null;
}

export interface MemoryMigrationPlan {
  files: readonly MemoryMigrationFile[];
  index: MemoryMigrationFile;
  archives: readonly MemoryMigrationArchive[];
}

function splitLegacyEntries(raw: string): string[] {
  if (raw.trim().length === 0) return [];
  return raw
    .split(MEMORY_ENTRY_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function renderDetailFile(entries: readonly string[]): string {
  return entries.join("\n\n");
}

export function planMemoryMigration(input: MemoryMigrationInput): MemoryMigrationPlan | null {
  const memoryEntries = splitLegacyEntries(input.memoryRaw ?? "");
  const userEntries = splitLegacyEntries(input.userRaw ?? "");
  if (memoryEntries.length === 0 && userEntries.length === 0) return null;

  const files: MemoryMigrationFile[] = [];
  const categories: MemoryIndexCategory[] = [];
  const archives: MemoryMigrationArchive[] = [];

  const targets = [
    { target: "memory", entries: memoryEntries, legacyFile: "MEMORY.md" },
    { target: "user", entries: userEntries, legacyFile: "USER.md" },
  ] as const;

  for (const { target, entries, legacyFile } of targets) {
    if (entries.length === 0) continue;
    const category = MIGRATED_CATEGORIES[target];
    files.push({ path: category.file, content: renderDetailFile(entries) });
    categories.push(category);
    archives.push({ from: legacyFile, to: `${legacyFile}${MEMORY_ARCHIVE_SUFFIX}` });
  }

  return {
    files,
    index: { path: MEMORY_INDEX_FILE, content: renderMemoryIndex(categories) },
    archives,
  };
}
