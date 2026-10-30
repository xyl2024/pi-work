import { createLogger } from "@/lib/server/logger";
import { getFileDiff, runGit } from "@/lib/server/git-diff";
import type {
  GitCommitDetailResponse,
  GitCommitFile,
  GitLogCommit,
  GitLogPageResponse,
} from "@/lib/shared/git-log-types";

const log = createLogger("git-log");

export const LOG_DEFAULT_PAGE_SIZE = 30;
export const LOG_MAX_PAGE_SIZE = 100;

export const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export async function getBranchList(repoRoot: string): Promise<string[]> {
  const res = await runGit(repoRoot, [
    "for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads",
  ]);
  if (!res) return [];
  return res.stdout.split("\n").filter(Boolean);
}

export interface LogDateFilter {
  since?: string;
  until?: string;
}

export async function getLogPage(
  repoRoot: string,
  branch: string | null,
  skip: number,
  limit: number,
  dateFilter?: LogDateFilter,
): Promise<GitLogPageResponse> {
  const clamped = Math.min(Math.max(limit, 1), LOG_MAX_PAGE_SIZE);
  const args: string[] = [
    "log",
    ...(branch ? [branch] : []),
    "--no-merges",
    ...(dateFilter?.since ? [`--since=${dateFilter.since}`] : []),
    ...(dateFilter?.until ? [`--until=${dateFilter.until}`] : []),
    `--skip=${Math.max(skip, 0)}`,
    `--max-count=${clamped + 1}`,
    "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%P",
  ];
  const res = await runGit(repoRoot, args);
  if (!res) {
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
    isMerge: (f[6] ?? "").includes(" "),
  };
}

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

async function resolveFirstParent(repoRoot: string, sha: string): Promise<string | null> {
  const res = await runGit(repoRoot, ["rev-parse", "--verify", "--quiet", `${sha}^`]);
  if (!res) return null;
  const parent = res.stdout.trim();
  return parent || null;
}

function parseNameStatusZ(output: string): Map<string, string> {
  const map = new Map<string, string>();
  const tokens = output.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    const m = /^([A-Z])(\d*)$/.exec(tok);
    if (!m) continue;
    const status = m[1];
    if (status === "R" || status === "C") {
      const newPath = tokens[i + 2];
      if (newPath) map.set(newPath, status);
      i += 2;
    } else {
      const path = tokens[i + 1];
      if (path) map.set(path, status);
      i += 1;
    }
  }
  return map;
}

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