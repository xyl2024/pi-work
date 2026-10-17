/**
 * Pure helpers for a skill's own files.
 *
 * The skills panel detail page and the retiring modal both render the same
 * three things: the SKILL.md body with its YAML frontmatter stripped, a
 * syntax-highlighter language for one attached file, and the attached-file
 * manifest grouped the same way (SKILL.md, then `scripts` / `references` /
 * `assets`, then any other directory, then loose root files).
 *
 * Keeping the rules here means the two surfaces cannot drift apart, and the
 * grouping / stripping behaviour is unit-testable without a browser. No fs /
 * path / pi SDK imports — this module is shared by the server route types and
 * the client bundle.
 */

import type { SkillDetailFile } from "./skills";

// ── File extension → syntax-highlighter language ────────────────────────
// Mirrors the EXT_TO_LANGUAGE map in app/api/files/[...path]/route.ts — a new
// extension there should be mirrored here too.
const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  html: "html", htm: "html", css: "css", scss: "css", less: "css",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", xml: "xml", md: "markdown", mdx: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  sql: "sql", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl",
  env: "bash", gitignore: "bash",
};

/** Resolve a filename to a syntax-highlighter language id. */
export function fileLanguage(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  // Special-case filenames without extensions (Dockerfile, Makefile)
  const base = fileName.toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile") return "makefile";
  if (base.startsWith(".env")) return "bash";
  return EXT_TO_LANGUAGE[ext] || "text";
}

/**
 * Strip a leading YAML frontmatter block (`--- ... ---`) from a markdown
 * document — the skill's name/description frontmatter is surfaced separately
 * in the detail page, so the rendered body stays clean.
 */
export function stripFrontmatter(md: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return match ? md.slice(match[0].length) : md;
}

// ── Attached-file grouping ──────────────────────────────────────────────

/** Pretty-print names for the well-known top-level directories in a skill. */
const FILE_GROUP_LABELS: Record<string, string> = {
  scripts: "Scripts",
  references: "References",
  assets: "Assets",
};

/** The group holding the skill's own SKILL.md. */
const SKILL_MD_KEY = "__skillmd";
/** The group holding loose files at the skill directory root. */
const OTHER_FILES_KEY = "other";
/** Known directory groups, in the order they should render. */
const KNOWN_DIR_ORDER = ["scripts", "references", "assets"];

/** One section of the attached-file manifest. */
export interface SkillFileGroup {
  /** Stable identity: `__skillmd`, a top-level directory name, or `other`. */
  key: string;
  /** Display label: `SKILL.md`, a pretty directory name, or `Other files`. */
  label: string;
  files: SkillDetailFile[];
}

function isRootSkillMd(file: SkillDetailFile): boolean {
  return !file.isDirectory && file.name === "SKILL.md" && !file.relativePath.includes("/");
}

function isTopLevelDir(file: SkillDetailFile): boolean {
  return file.isDirectory && !file.relativePath.includes("/");
}

/**
 * Group a skill's flat file manifest into the sections the detail page
 * renders, in this fixed order: SKILL.md first, then the known directories
 * (`scripts` / `references` / `assets`), then any other top-level directory
 * alphabetically, then loose root files under "Other files". Empty
 * directories are dropped; files nested deeper inside a directory stay with
 * that directory's group.
 */
export function groupSkillFiles(files: readonly SkillDetailFile[]): SkillFileGroup[] {
  const dirGroups: SkillFileGroup[] = [];

  const skillMd = files.find(isRootSkillMd);
  if (skillMd) dirGroups.push({ key: SKILL_MD_KEY, label: "SKILL.md", files: [skillMd] });

  for (const dir of files.filter(isTopLevelDir)) {
    const prefix = `${dir.relativePath}/`;
    const children = files
      .filter((file) => !file.isDirectory && file.relativePath.startsWith(prefix))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (children.length > 0) {
      dirGroups.push({
        key: dir.name,
        label: FILE_GROUP_LABELS[dir.name] ?? dir.name,
        files: children,
      });
    }
  }

  dirGroups.sort((a, b) => {
    if (a.key === SKILL_MD_KEY) return -1;
    if (b.key === SKILL_MD_KEY) return 1;
    const ai = KNOWN_DIR_ORDER.indexOf(a.key);
    const bi = KNOWN_DIR_ORDER.indexOf(b.key);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.key.localeCompare(b.key);
  });

  const rootFiles = files
    .filter((file) => !file.isDirectory && !file.relativePath.includes("/") && file.name !== "SKILL.md")
    .sort((a, b) => a.name.localeCompare(b.name));
  if (rootFiles.length > 0) {
    dirGroups.push({ key: OTHER_FILES_KEY, label: "Other files", files: rootFiles });
  }

  return dirGroups;
}
