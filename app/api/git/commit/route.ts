import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getRepoRoot } from "@/lib/server/git-diff";
import { getCommitDetail } from "@/lib/server/git-log";

export const dynamic = "force-dynamic";

const log = createLogger("api/git/commit");

// GET /api/git/commit?cwd=<path>&commit=<sha>
// Returns metadata + full message + per-file +N/-M stats for one commit.
// Merge commits return `files: []` with `commit.isMerge: true` (the UI
// shows a banner instead of a file list). File *contents* are NOT returned
// here — GitLogView fetches them lazily per file via /api/git/diff?commit=.
//
// Same cwd-trust rationale as /api/git and /api/git/log: the caller is a
// session cwd already validated at session creation, and the response
// carries only public git metadata.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const commit = searchParams.get("commit");
  const startedAt = Date.now();

  if (!cwd || !commit) {
    log.warn("get git commit rejected", { reason: "missing cwd or commit", durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "cwd and commit required" }, { status: 400 });
  }

  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) {
    return NextResponse.json({ commit: null, body: null, files: [] }, { status: 200 });
  }

  const detail = await getCommitDetail(repoRoot, commit);
  if (!detail) {
    // Unknown sha / git broken — same null-payload convention as the diff
    // routes, letting the client distinguish "no such commit" from a
    // transport failure without special-casing status codes.
    return NextResponse.json({ commit: null, body: null, files: [] }, { status: 200 });
  }

  log.info("get git commit completed", {
    cwd, repoRoot, commit, isMerge: detail.commit.isMerge,
    fileCount: detail.files.length, bodyBytes: detail.body.length,
    durationMs: elapsedMs(startedAt),
  });

  return NextResponse.json(detail);
}