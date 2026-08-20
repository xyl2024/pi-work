/**
 * Pure helpers + lookup tables used by the SkillsConfig modal.
 *
 * CONTENTS
 * ────────
 * • shortenPath          — collapse `/Users/xxx/...` and `/home/xxx/...` to `~`.
 * • EXT_TO_LANGUAGE      — file extension → react-syntax-highlighter language.
 * • fileLanguage         — resolve a filename to a language id (handles
 *                          extensionless files like Dockerfile/Makefile).
 * • sourceLabel          — collapse Skill.sourceInfo into the three labels
 *                          the sidebar groups by (`project` / `global` / `path`).
 * • FILE_GROUP_LABELS    — pretty-print names for the known top-level
 *                          directories inside a skill (`scripts`, `references`,
 *                          `assets`). Used to render SkillDetail's file groups.
 *
 * EXT_TO_LANGUAGE mirrors the map in app/api/files/[...path]/route.ts — any
 * new extension added there should be mirrored here too.
 */

import type { Skill } from "./types";

export function shortenPath(p: string): string {
  // Match common home dir patterns: /Users/xxx, /home/xxx
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

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

export function sourceLabel(skill: Skill): string {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

// ── File section grouping labels ──

export const FILE_GROUP_LABELS: Record<string, string> = {
  scripts: "Scripts",
  references: "References",
  assets: "Assets",
};
