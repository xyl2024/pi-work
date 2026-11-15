import { MEMORY_ENTRY_SEPARATOR } from "./memory";

export const MEMORY_DIR_NAME = "memory";
export const MEMORY_INDEX_FILE = "INDEX.md";
export const MEMORY_INDEX_BUDGET = 2000;
export const MEMORY_ARCHIVE_SUFFIX = ".bak";

export const MEMORY_GUIDANCE = [
  "## 记忆管理",
  "",
  "记忆以两级 Markdown 文件存储在记忆数据目录 memory/ 下：",
  "- 索引：memory/INDEX.md，会话开始时冻结注入（见下方索引内容），运行中改动不会刷新本次注入。",
  "- 明细：memory/<分类>.md，按分类存放细节，用 read / write / edit 实时读写。",
  "",
  "约定：",
  "1. 新事实写入对应明细文件；没有合适分类就新建文件，文件名用小写连字符。",
  "2. 写完明细后同步更新索引：每个现存分类一行（相对路径 + 一句话说明），并维护用户偏好摘要。",
  "3. 索引保持在 2000 字符以内：只放分类目录与高价值摘要，细节一律进明细文件。",
  "4. 读记忆时先看索引定位分类，再按需读取对应明细，不要全量读取。",
  "5. 记忆是全局的，与当前工作目录无关；不要把某个项目专属信息写进记忆。",
].join("\n");

export const MEMORY_EMPTY_STATE = [
  "当前索引为空：还没有任何记忆。",
  "按需惰性创建：先用户新学到事实时再创建 memory/INDEX.md 与对应分类明细，",
  "不要预先批量创建文件，也不要在没有事实时写占位内容。",
].join(" ");

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

export function renderMemoryInjection(indexContent: string): string {
  const trimmed = indexContent.trim();
  if (trimmed.length === 0) {
    return `${MEMORY_GUIDANCE}\n\n${MEMORY_EMPTY_STATE}`;
  }
  return `${MEMORY_GUIDANCE}\n\n## 当前记忆索引\n\n${trimmed}`;
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
