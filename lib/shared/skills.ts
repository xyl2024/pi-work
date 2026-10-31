export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  frontmatterDisabled?: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
}

export interface SkillListResponse {
  skills: Skill[];
  diagnostics?: unknown[];
}

export interface SkillToggleRequest {
  cwd: string;
  filePath: string;
  disableModelInvocation: boolean;
}

export interface SkillToggleResponse {
  success: true;
  disableModelInvocation: boolean;
}

export interface SkillDetailFile {
  name: string;
  path: string;
  relativePath: string;
  size: number;
  isText: boolean;
  isDirectory: boolean;
}

export interface SkillDetailData {
  content: string;
  directory: string;
  files: SkillDetailFile[];
}

export interface SkillSubFileResponse {
  subFileContent: string;
  subFilePath: string;
}

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
  slug: string;
  description: string;
}

export interface SkillSearchRequest {
  query: string;
  page?: number;
  pageSize?: number;
}

export interface SkillSearchResponse {
  results: SkillSearchResult[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export type SkillInstallScope = "global" | "project";

export interface SkillInstallRequest {
  package: string;
  scope: SkillInstallScope;
  cwd?: string;
}

export interface SkillInstallEvent {
  type: "log" | "done" | "error";
  line?: string;
  message?: string;
}

export type SkillInstallPhase = "idle" | "running" | "done" | "error";

export type SkillGroup = "pi-work" | "global" | "project" | "path";

export const SKILL_GROUP_ORDER: readonly SkillGroup[] = [
  "pi-work",
  "project",
  "global",
  "path",
];

export function skillGroup(skill: Skill): SkillGroup {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (src === "pi-work" || scope === "pi-work") return "pi-work";
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

export function filterSkills(skills: readonly Skill[], query: string): Skill[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...skills];
  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(needle) ||
      skill.description.toLowerCase().includes(needle),
  );
}

export function groupSkills(
  skills: readonly Skill[],
): { group: SkillGroup; skills: Skill[] }[] {
  const groups: { group: SkillGroup; skills: Skill[] }[] = [];
  for (const group of SKILL_GROUP_ORDER) {
    const bucket = skills.filter((skill) => skillGroup(skill) === group);
    if (bucket.length > 0) groups.push({ group, skills: bucket });
  }
  return groups;
}
