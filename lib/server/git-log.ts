// Server-side git history operations for the GitPanel's Log view. Runs
// `git` via runGit (execFile, never a shell) so user-supplied paths/refs
// are never interpreted as shell syntax — same boundary as git-diff.ts.
//
// Wire formats are NUL-delimited (`-z` / `%x00`) so paths with spaces,
// unicode, or newlines come through verbatim; NUL cannot appear in commit
// metadata or paths, so record splitting is unambiguous.

import { createLogger } from "@/lib/server/logger";
import { getFileDiff, runGit } from "@/lib/server/git-diff";
import type {
  GitCommitDetailResponse,
  GitCommitFile,
  GitLogCommit,
  GitLogPageResponse,
} from "@/lib/shared/git-log-types";

const log = createLogger("git-log");

/** Default page size for the log list; the route clamps `limit` to this. */
export const LOG_DEFAULT_PAGE_SIZE = 30;
/** Hard cap on a single page so a misbehaving client can't ask for 10k
 *  commits at once. */
export const LOG_MAX_PAGE_SIZE = 100;

/** The empty tree object, present in every repo. Used as the `from` side
 *  when diffing a root commit (which has no parent). */
export const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Head branches, most recently committed first. Returns [] when git is
 *  broken or there are no branches (shouldn't happen in a repo). */
export async function getBranchList(repoRoot: string): Promise<string[]> {
  const res = await runGit(repoRoot, [
    "for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads",
  ]);
  if (!res) return [];
  return res.stdout.split("\n").filter(Boolean);
}

/** One page of commit history for `branch` (null = HEAD), skipping merge
 *  commits. `skip` is the cumulative offset for infinite-scroll style
 *  loading; `hasMore` is computed by fetching one extra commit. */
export async function getLogPage(
  repoRoot: string,
  branch: string | null,
  skip: number,
  limit: number,
): Promise<GitLogPageResponse> {
  const clamped = Math.min(Math.max(limit, 1), LOG_MAX_PAGE_SIZE);
  const res = await runGit(repoRoot, [
    "log",
    ...(branch ? [branch] : []),
    "--no-merges",
    `--skip=${Math.max(skip, 0)}`,
    `--max-count=${clamped + 1}`,
    // Hash, short hash, author name, author email, author date (strict
    // ISO), subject, parent hashes. Fields are NUL-separated, records
    // newline-separated.
    "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%P",
  ]);
  if (!res) {
    // Invalid branch (deleted while listed) or git broken → empty page,
    // matching the "empty state" contract every other git route uses.
    log.warn("git log page failed", { repoRoot, branch, skip, error: "git exited non-zero" });
    return { commits: [], hasMore: false };
  }
  const records = res.stdout.split("\n").filter(Boolean);
  const hasMore = records.length > clamped;
  const commits: GitLogCommit[] = [];
  for (const line of records.slice(0, clamped)) {
    const c = parseLogRecord(line);
    if (c) commits.push(c);
  }
  return { commits, hasMore };
}

function parseLogRecord(line: string): GitLogCommit | null {
  const f = line.split("\0");
  if (f.length < 6 || !f[0]) return null;
  return {
    fullHash: f[0],
    shortHash: f[1],
    authorName: f[2],
    authorEmail: f[3],
    authorDate: f[4],
    subject: f[5],
    // Two or more parents (space-separated %P) = merge commit.
    isMerge: (f[6] ?? "").includes(" "),
  };
}

/** Full detail for one commit: metadata + full message + per-file
 *  stats. Merge commits short-circuit to `files: []` — a merge's combined
 *  diff is multiparent and doesn't map to per-file +N/-M. Returns null
 *  when the sha doesn't exist (or git is broken). */
export async function getCommitDetail(
  repoRoot: string,
  sha: string,
): Promise<GitCommitDetailResponse | null> {
  const metaRes = await runGit(repoRoot, [
    "log", "-1",
    "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%P%x00%B",
    sha,
  ]);
  if (!metaRes) return null;
  const f = metaRes.stdout.split("\0");
  if (!f[0]) return null;
  const isMerge = (f[6] ?? "").includes(" ");
  // `git log` appends a trailing newline after %B.
  const body = (f[7] ?? "").replace(/\n$/, "");
  const commit: GitLogCommit = {
    fullHash: f[0],
    shortHash: f[1],
    authorName: f[2],
    authorEmail: f[3],
    authorDate: f[4],
    subject: f[5],
    isMerge,
  };
  if (isMerge) {
    return { commit, body, files: [] };
  }

  // `git show` on a root commit diffs against the empty tree automatically.
  const [statusRes, numstatRes] = await Promise.all([
    runGit(repoRoot, ["show", sha, "--format=", "--name-status", "-z"]),
    runGit(repoRoot, ["show", sha, "--format=", "--numstat", "-z"]),
  ]);
  const statuses = parseNameStatusZ(statusRes?.stdout ?? "");
  const stats = parseNumstatZForLog(numstatRes?.stdout ?? "");

  const files: GitCommitFile[] = [];
  for (const [path, status] of statuses) {
    const s = stats.get(path);
    files.push({ path, status, additions: s?.add ?? 0, deletions: s?.del ?? 0 });
  }
  return { commit, body, files };
}

/**
 * Unified diff of one file *within* a commit (parent..commit). Resolves
 * the parent ourselves — root commits fall back to the empty tree — so
 * the /api/git/diff route and GitLogView never deal with the empty-tree
 * special case. Reuses getFileDiff's cap/truncation semantics.
 */
export async function getFileDiffAtCommit(
  repoRoot: string,
  sha: string,
  filePath: string,
): Promise<{ diff: string | null; truncated: boolean }> {
  const parent = await resolveFirstParent(repoRoot, sha);
  return getFileDiff(repoRoot, filePath, false, false, {
    from: parent ?? EMPTY_TREE_HASH,
    to: sha,
  });
}

/** First parent of a commit, or null when it's a root commit / the sha is
 *  unresolvable. `rev-parse --verify --quiet <sha>^` exits non-zero only
 *  for "no such parent", so runGit's null-on-nonzero maps directly. */
async function resolveFirstParent(repoRoot: string, sha: string): Promise<string | null> {
  const res = await runGit(repoRoot, ["rev-parse", "--verify", "--quiet", `${sha}^`]);
  if (!res) return null;
  const parent = res.stdout.trim();
  return parent || null;
}

/**
 * Parse `git show --name-status -z` output into path → status letter.
 *
 * Verified record layouts (see the `git mv` fixture in commit history):
 *   modified: `M\0path\0`
 *   rename:   `R100\0old-path\0new-path\0`   (old first, then new)
 * The score digits are stripped so every status maps to the plain letter.
 */
function parseNameStatusZ(output: string): Map<string, string> {
  const map = new Map<string, string>();
  const tokens = output.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    const m = /^([A-Z])(\d*)$/.exec(tok);
    if (!m) continue; // not a status token (e.g. leftover path)
    const status = m[1];
    if (status === "R" || status === "C") {
      const newPath = tokens[i + 2];
      if (newPath) map.set(newPath, status);
      i += 2; // consumed old + new path tokens
    } else {
      const path = tokens[i + 1];
      if (path) map.set(path, status);
      i += 1;
    }
  }
  return map;
}

/**
 * Parse `git show --numstat -z` output into path → {add, del}. Same -z
 * rename shape as name-status: `0\t0\t\0old\0new\0` (empty path token,
 * then old, then new) — both paths are recorded so pairing with the
 * name-status map (keyed by new path) always matches.
 */
function parseNumstatZForLog(output: string): Map<string, { add: number; del: number }> {
  const map = new Map<string, { add: number; del: number }>();
  const tokens = output.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const m = /^(\d+)\t(\d+)\t(.*)$/.exec(tokens[i]);
    if (!m) continue;
    const stats = { add: Number(m[1]), del: Number(m[2]) };
    const filePath = m[3];
    if (filePath) {
      map.set(filePath, stats);
    } else if (i + 2 < tokens.length) {
      map.set(tokens[i + 1], stats);
      map.set(tokens[i + 2], stats);
      i += 2;
    }
  }
  return map;
}