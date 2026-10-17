import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative, extname } from "path";
import type { SkillDetailData, SkillDetailFile, SkillSubFileResponse } from "@/lib/shared/skills";

export const dynamic = "force-dynamic";

const TEXT_EXTS = new Set([
  ".md", ".mdx", ".txt", ".json", ".yaml", ".yml", ".toml",
  ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
  ".css", ".scss", ".less", ".html", ".htm",
  ".sh", ".bash", ".zsh", ".fish",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".cpp", ".h", ".hpp",
  ".xml", ".svg", ".env", ".example", ".gitignore",
  ".conf", ".cfg", ".ini", ".properties",
  ".sql", ".r", ".lua", ".pl",
  ".vue", ".svelte", ".astro",
  ".diff", ".patch",
]);

// Directories to skip when scanning skill files
const SKIP_DIRS = new Set(["node_modules", ".git", ".svn", "__pycache__"]);

// File patterns to skip
const SKIP_FILES = /^\./; // hidden files

function isTextFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return TEXT_EXTS.has(ext);
}

/**
 * Recursively list files in a directory (up to maxDepth).
 * Returns flat array of SkillDetailFile.
 */
function scanFiles(dir: string, baseDir: string, maxDepth: number): SkillDetailFile[] {
  if (maxDepth <= 0) return [];
  const entries: SkillDetailFile[] = [];

  try {
    const names = readdirSync(dir);
    for (const name of names) {
      if (SKIP_FILES.test(name)) continue;
      const fullPath = join(dir, name);
      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }

      const relativePath = relative(baseDir, fullPath);

      if (stats.isDirectory()) {
        if (!SKIP_DIRS.has(name)) {
          // Add the directory itself as an entry (collapsible group)
          entries.push({
            name,
            path: fullPath,
            relativePath,
            size: 0,
            isText: false,
            isDirectory: true,
          });
          // Recurse into it (maxDepth-1 to go one level deeper)
          entries.push(...scanFiles(fullPath, baseDir, maxDepth - 1));
        }
      } else if (stats.isFile()) {
        entries.push({
          name,
          path: fullPath,
          relativePath,
          size: stats.size,
          isText: isTextFile(name),
          isDirectory: false,
        });
      }
    }
  } catch {
    // Directory doesn't exist or can't be read — skip
  }

  return entries;
}

function parseDir(dir: string): { files: SkillDetailFile[] } {
  // Scan 2 levels deep (skill dir → immediate children)
  // Dirs are included as entries, so a file at scripts/process.sh
  // will appear both:
  //   { name: "scripts", isDirectory: true }
  //   { name: "process.sh", relativePath: "scripts/process.sh", ... }
  const files = scanFiles(dir, dir, 2);
  return { files };
}

// GET /api/skills/detail?filePath=<path>&subFilePath=<relative path>
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const filePath = searchParams.get("filePath");
  const subFilePath = searchParams.get("subFilePath");

  if (!filePath) {
    return NextResponse.json({ error: "filePath required" }, { status: 400 });
  }

  // Resolve the skill directory from the SKILL.md path
  const skillDir = filePath.replace(/\/SKILL\.md$/i, "");

  // If subFilePath is provided, read that specific file
  if (subFilePath) {
    const resolvedPath = join(skillDir, subFilePath);
    // Prevent path traversal
    if (!resolvedPath.startsWith(skillDir)) {
      return NextResponse.json({ error: "invalid subFilePath" }, { status: 400 });
    }
    if (!existsSync(resolvedPath)) {
      return NextResponse.json({ error: "file not found" }, { status: 404 });
    }
    const stats = statSync(resolvedPath);
    if (!stats.isFile()) {
      return NextResponse.json({ error: "not a file" }, { status: 400 });
    }
    if (!isTextFile(resolvedPath)) {
      return NextResponse.json({ error: "binary file cannot be previewed" }, { status: 415 });
    }
    if (stats.size > 256 * 1024) {
      return NextResponse.json({ error: "file too large to preview (max 256 KiB)" }, { status: 413 });
    }
    const content = readFileSync(resolvedPath, "utf-8");
    const body: SkillSubFileResponse = { subFileContent: content, subFilePath };
    return NextResponse.json(body);
  }

  // Read SKILL.md content
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "SKILL.md not found" }, { status: 404 });
  }
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    return NextResponse.json({ error: "not a file" }, { status: 400 });
  }
  const content = readFileSync(filePath, "utf-8");

  // Scan the skill directory for sub-files
  const { files } = parseDir(skillDir);

  const body: SkillDetailData = { content, directory: skillDir, files };
  return NextResponse.json(body);
}
