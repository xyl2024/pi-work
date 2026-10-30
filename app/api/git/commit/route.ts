import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getRepoRoot } from "@/lib/server/git-diff";
import { getCommitDetail } from "@/lib/server/git-log";

export const dynamic = "force-dynamic";

const log = createLogger("api/git/commit");

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
    return NextResponse.json({ commit: null, body: null, files: [] }, { status: 200 });
  }

  log.info("get git commit completed", {
    cwd, repoRoot, commit, isMerge: detail.commit.isMerge,
    fileCount: detail.files.length, bodyBytes: detail.body.length,
    durationMs: elapsedMs(startedAt),
  });

  return NextResponse.json(detail);
}