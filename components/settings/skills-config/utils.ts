/**
 * Pure helpers + lookup tables used by the SkillsConfig modal.
 *
 * CONTENTS
 * ────────
 * • EXT_TO_LANGUAGE      — file extension → react-syntax-highlighter language.
 * • fileLanguage         — resolve a filename to a language id (handles
 *                          extensionless files like Dockerfile/Makefile).
 * • stripFrontmatter     — drop the leading YAML block before rendering.
 * • FILE_GROUP_LABELS    — pretty-print names for the known top-level
 *                          directories inside a skill (`scripts`, `references`,
 *                          `assets`). Used to render SkillDetail's file groups.
 *
 * EXT_TO_LANGUAGE mirrors the map in app/api/files/[...path]/route.ts — any
 * new extension added there should be mirrored here too.
 *
 * The display helpers that are not skills-specific have moved on: path
 * shortening is `lib/client/paths`, and the source grouping rule is
 * `skillGroup` in `lib/shared/skills`.
 */

// ── File extension → syntax-highlighter language ──
// Mirrors the EXT_TO_LANGUAGE map in app/api/files/[...path]/route.ts
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

export function fileLanguage(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  // Special-case filenames without extensions (Dockerfile, Makefile)
  const base = fileName.toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile") return "makefile";
  if (base.startsWith(".env")) return "bash";
  return EXT_TO_LANGUAGE[ext] || "text";
}

/** Strip a leading YAML frontmatter block (`--- ... ---`) from a markdown
 *  document — the skill's name/description frontmatter is surfaced separately
 *  in the detail page's Metadata section, so the rendered body stays clean. */
export function stripFrontmatter(md: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return match ? md.slice(match[0].length) : md;
}

// ── File section grouping labels ──

export const FILE_GROUP_LABELS: Record<string, string> = {
  scripts: "Scripts",
  references: "References",
  assets: "Assets",
};
