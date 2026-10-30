import { NextResponse } from "next/server";
import path from "path";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getFileDiff, getRepoRoot } from "@/lib/server/git-diff";
import { getFileDiffAtCommit } from "@/lib/server/git-log";

export const dynamic = "force-dynamic";

const log = createLogger("api/git/diff");

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const file = searchParams.get("file");
  const stagedParam = searchParams.get("staged");
  const startedAt = Date.now();

  if (!cwd || !file) {
    log.warn("get git diff rejected", { reason: "missing cwd or file", durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "cwd and file required" }, { status: 400 });
  }
  const staged = stagedParam === "1";
  const baseHead = searchParams.get("base") === "head";
  const commit = searchParams.get("commit");

  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) {
    return NextResponse.json({ diff: null, truncated: false }, { status: 200 });
  }

  const relFile = path.isAbsolute(file) ? path.relative(repoRoot, file) : file;

  const { diff, truncated } = commit
    ? await getFileDiffAtCommit(repoRoot, commit, relFile)
    : await getFileDiff(repoRoot, relFile, staged, baseHead);
  log.info("get git diff completed", {
    cwd, file: relFile, staged, repoRoot, commit: commit ?? null,
    bytes: diff?.length ?? 0,
    truncated,
    durationMs: elapsedMs(startedAt),
  });

  return NextResponse.json({ diff, truncated });
}
