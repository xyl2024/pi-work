// Client-safe types for the git log pane of the GitPanel. No server-only
// imports here — shared between the API routes (server) and GitLogView
// (client), mirroring the pattern in git-diff-types.ts.

/** One commit in a log list entry. Dates are strict ISO-8601 strings
 *  (e.g. `2024-05-01T10:30:00+08:00`) formatted by the server from
 *  `%aI`, so the client never does timezone math. */
export interface GitLogCommit {
  fullHash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  /** Author date, strict ISO-8601. */
  authorDate: string;
  /** Multiple parents (= merge commit). The log list hides merges by
   *  default, but the detail endpoint may still return one — the UI
   *  shows a banner instead of a file list. */
  isMerge: boolean;
}

/** One changed file inside a commit. `status` is git's name-status
 *  letter (A/M/D/R/C/T/U). `additions`/`deletions` come from numstat. */
export interface GitCommitFile {
  /** Path relative to the repo root. For renames this is the new path. */
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

/** Response of GET /api/git/log?cwd=&branch=&skip=&limit=.
 *  The endpoint also accepts optional `since`/`until` ISO-day params that
 *  restrict results to commits in that date range (end-inclusive). */
export interface GitLogPageResponse {
  commits: GitLogCommit[];
  /** True when more commits exist beyond this page (`skip + limit`). */
  hasMore: boolean;
}

/** Response of GET /api/git/commit?cwd=&commit=. */
export interface GitCommitDetailResponse {
  commit: GitLogCommit;
  /** Full commit message body (everything after the subject line). */
  body: string;
  /** Changed files with +N/-M stats. Empty and meaningless for merges
   *  (`commit.isMerge` is the authoritative flag). */
  files: GitCommitFile[];
}