/**
 * The Skills contract shared by the `/api/skills*` routes and every client
 * that reads them (the panel view, and the retired modal while it is being
 * dismantled).
 *
 * Pure data only — no fs / path / pi SDK — so the same definitions are the
 * server routes' response type and the browser bundle's input type, and a
 * contract change lands in one place instead of being mirrored in a route and
 * a component type file.
 */

/** One skill as `/api/skills` reports it. */
export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  /** Set when SKILL.md frontmatter has `disable-model-invocation: true` —
   *  pi never lists the skill in the system prompt and the toggle is locked. */
  frontmatterDisabled?: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
}

/** `GET /api/skills?cwd=…` — the discovered skills with Pi Work overrides applied. */
export interface SkillListResponse {
  skills: Skill[];
  /** pi's loader diagnostics (unreadable SKILL.md, bad frontmatter, …).
   *  Opaque to the client today; kept on the wire so a caller can surface
   *  them without a contract change. */
  diagnostics?: unknown[];
}

/** `PATCH /api/skills` body — toggles one skill in Pi Work's per-cwd config. */
export interface SkillToggleRequest {
  cwd: string;
  filePath: string;
  disableModelInvocation: boolean;
}

/** `PATCH /api/skills` success body. */
export interface SkillToggleResponse {
  success: true;
  disableModelInvocation: boolean;
}

/** One entry in a skill directory listing. */
export interface SkillDetailFile {
  name: string;
  path: string;
  relativePath: string;
  size: number;
  isText: boolean;
  isDirectory: boolean;
}

/** `GET /api/skills/detail?filePath=…` — the SKILL.md body plus its directory. */
export interface SkillDetailData {
  content: string;
  directory: string;
  files: SkillDetailFile[];
}

/** `GET /api/skills/detail?filePath=…&subFilePath=…` — one attached file's text. */
export interface SkillSubFileResponse {
  subFileContent: string;
  subFilePath: string;
}

/** One skills.sh search hit. */
export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
  /** skills.sh page path (`owner/repo/skill`), used to resolve the description. */
  slug: string;
  /** Full SKILL.md description, resolved server-side with the search so the
   *  panel never has to fetch it lazily. Empty when unavailable. */
  description: string;
}

/** `POST /api/skills/search` body. */
export interface SkillSearchRequest {
  query: string;
  page?: number;
  pageSize?: number;
}

/** `POST /api/skills/search` response. */
export interface SkillSearchResponse {
  results: SkillSearchResult[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Where `npx skills add` drops the skill. */
export type SkillInstallScope = "global" | "project";

/** `POST /api/skills/install` body. */
export interface SkillInstallRequest {
  package: string;
  scope: SkillInstallScope;
  cwd?: string;
}

/** One event in the streaming `POST /api/skills/install` body. */
export interface SkillInstallEvent {
  type: "log" | "done" | "error";
  line?: string;
  message?: string;
}

// ── Grouping (one source for the grid's grouping rule) ──────────────────

/** The four buckets a skill can be loaded from. */
export type SkillGroup = "pi-work" | "global" | "project" | "path";

/**
 * Group render order — Pi Work's own skills first, then the project's, then
 * the user's global ones, then anything reached by an explicit path. This is
 * the order the modal used and the panel keeps.
 */
export const SKILL_GROUP_ORDER: readonly SkillGroup[] = [
  "pi-work",
  "project",
  "global",
  "path",
];

/** Collapse `Skill.sourceInfo` into the bucket the grid groups it under. */
export function skillGroup(skill: Skill): SkillGroup {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (src === "pi-work" || scope === "pi-work") return "pi-work";
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

/** Group a skill list into {@link SKILL_GROUP_ORDER} order, dropping empty groups. */
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
