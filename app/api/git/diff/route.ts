import { NextResponse } from "next/server";
import path from "path";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getFileDiff, getRepoRoot } from "@/lib/server/git-diff";

export const dynamic = "force-dynamic";

const log = createLogger("api/git/diff");

// GET /api/git/diff?cwd=<path>&file=<rel-or-abs-path>&staged=<0|1>&base=head
// Returns the unified diff for one file. `base=head` diffs the worktree
// against HEAD (staged + unstaged combined) instead of the index.
//
// `cwd` is supplied by the client (always a session cwd that was already
// validated at session creation) so we deliberately skip ensurePathAllowed
// here — that check would force a `listAllSessions()` scan on every call.
// `file` is relative to the repo root, or an absolute path inside the repo
// (FileViewer sends absolute paths; git itself refuses paths outside the
// repo, so `..` traversal is harmless).
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

  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) {
    return NextResponse.json({ diff: null, truncated: false }, { status: 200 });
  }

  // Accept absolute paths (FileViewer) and repo-root-relative paths (panel).
  const relFile = path.isAbsolute(file) ? path.relative(repoRoot, file) : file;

  const { diff, truncated } = await getFileDiff(repoRoot, relFile, staged, baseHead);
  log.info("get git diff completed", {
    cwd, file: relFile, staged, repoRoot,
    bytes: diff?.length ?? 0,
    truncated,
    durationMs: elapsedMs(startedAt),
  });

  return NextResponse.json({ diff, truncated });
}
