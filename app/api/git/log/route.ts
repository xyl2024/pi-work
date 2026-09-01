import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getRepoRoot } from "@/lib/server/git-diff";
import { getLogPage, LOG_DEFAULT_PAGE_SIZE, LOG_MAX_PAGE_SIZE } from "@/lib/server/git-log";

export const dynamic = "force-dynamic";

const log = createLogger("api/git/log");

// GET /api/git/log?cwd=<path>&branch=<name>&skip=<n>&limit=<n>&since=<date>&until=<date>
// Returns one page of commit history for a branch (default: current HEAD),
// Merge commits are hidden server-side (`git log --no-merges`); `hasMore`
// tells the client whether another page exists at `skip + limit`.
//
// `cwd` is supplied by the client (always a session cwd that was already
// validated at session creation) so we deliberately skip ensurePathAllowed
// here, same as /api/git — the response exposes only commit metadata
// (hash, author, subject, date) and never file contents.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const branch = searchParams.get("branch");
  const skipParam = searchParams.get("skip");
  const limitParam = searchParams.get("limit");
  // Optional ISO-day date range; git parses these via --since/--until.
  const since = searchParams.get("since") || undefined;
  const until = searchParams.get("until") || undefined;
  const startedAt = Date.now();

  if (!cwd) {
    log.warn("get git log rejected", { reason: "missing cwd", durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "cwd required" }, { status: 400 });
  }

  const skip = Number.isFinite(Number(skipParam)) ? Number(skipParam) : 0;
  const limit = Number.isFinite(Number(limitParam)) ? Number(limitParam) : LOG_DEFAULT_PAGE_SIZE;

  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) {
    return NextResponse.json({ commits: [], hasMore: false }, { status: 200 });
  }

  const page = await getLogPage(repoRoot, branch || null, skip, limit, { since, until });
  log.info("get git log completed", {
    cwd, repoRoot, branch: branch || "(HEAD)", skip,
    limit: Math.min(Math.max(limit, 1), LOG_MAX_PAGE_SIZE),
    commitCount: page.commits.length, hasMore: page.hasMore,
    since: since || null, until: until || null,
    durationMs: elapsedMs(startedAt),
  });

  return NextResponse.json(page);
}