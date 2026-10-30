export type GitFileStatus =
  | "A"
  | "M"
  | "D"
  | "R"
  | "C"
  | "T"
  | "U"
  | "??";

export interface GitDiffFile {
  path: string;
  status: GitFileStatus;
  hasStaged: boolean;
  hasUnstaged: boolean;
  additions: number;
  deletions: number;
}

export interface GitStatusResponse {
  repoRoot: string | null;
  cwdRelToRepo: string | null;
  branch: string | null;
  files: GitDiffFile[];
}

export interface GitDiffResponse {
  diff: string | null;
  truncated: boolean;
}
