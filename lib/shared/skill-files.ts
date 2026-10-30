import type { SkillDetailFile } from "./skills";

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
  const base = fileName.toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile") return "makefile";
  if (base.startsWith(".env")) return "bash";
  return EXT_TO_LANGUAGE[ext] || "text";
}

export function stripFrontmatter(md: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return match ? md.slice(match[0].length) : md;
}

const FILE_GROUP_LABELS: Record<string, string> = {
  scripts: "Scripts",
  references: "References",
  assets: "Assets",
};

const SKILL_MD_KEY = "__skillmd";
const OTHER_FILES_KEY = "other";
const KNOWN_DIR_ORDER = ["scripts", "references", "assets"];

export interface SkillFileGroup {
  key: string;
  label: string;
  files: SkillDetailFile[];
}

function isRootSkillMd(file: SkillDetailFile): boolean {
  return !file.isDirectory && file.name === "SKILL.md" && !file.relativePath.includes("/");
}

function isTopLevelDir(file: SkillDetailFile): boolean {
  return file.isDirectory && !file.relativePath.includes("/");
}

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
