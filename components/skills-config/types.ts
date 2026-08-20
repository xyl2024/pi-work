/**
 * Shared types for the SkillsConfig modal.
 *
 * `Skill` matches the shape returned by /api/skills (see lib/skills/ server
 * side). `SkillDetailFile` / `SkillDetailData` match the /api/skills/detail
 * route response — kept structurally narrow on purpose so the UI only knows
 * about the fields it actually renders.
 */

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
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
