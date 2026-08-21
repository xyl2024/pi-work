import { NextResponse } from "next/server";
import path from "path";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getFileAtRef, getRepoRoot } from "@/lib/server/git-diff";

export const dynamic = "force-dynamic";

const log = createLogger("api/git/file-content");

// GET /api/git/file-content?cwd=<path>&file=<rel-or-abs-path>&ref=head
// Returns the raw text of a file at a git ref (HEAD by default). Designed
// for the right-side Monaco DiffEditor: it loads both the on-disk version
// and the HEAD version into in-memory models side-by-side.
//
// Non-200 responses (404 etc.) mean the request itself failed — bad
// cwd, repo vanished mid-call, git binary missing. A 200 with
// `{ content: null, exists: false }` is the *expected* response when
// the file has no version at HEAD (untracked, brand-new, or deleted
// in the last commit). The client uses `exists` to decide whether to
// show the diff view at all.
//
// `cwd` mirrors the convention from /api/git/diff: it's already
// validated at session creation, so we skip the allowed-roots scan
// here too.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const file = searchParams.get("file");
  const ref = searchParams.get("ref") ?? "HEAD";
  const startedAt = Date.now();

  if (!cwd || !file) {
    log.warn("get file-content rejected", { reason: "missing cwd or file", durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "cwd and file required" }, { status: 400 });
  }
  // Refuse obvious injection attempts early. git itself refuses
  // argument-like refs ("--upload-pack=…") when run via execFile,
  // but we still want a tight surface here.
  if (!/^[A-Za-z0-9._/~^@{}-]+$/.test(ref)) {
    log.warn("get file-content rejected", { reason: "bad ref", ref, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "invalid ref" }, { status: 400 });
  }

  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) {
    // Not a git repo — same "expected" path as missing-in-HEAD.
    return NextResponse.json(
      { content: null, exists: false, truncated: false, ref, repoRoot: null },
      { status: 200 },
    );
  }

  const relFile = path.isAbsolute(file) ? path.relative(repoRoot, file) : file;
  // path.relative can return paths starting with `..` if `file` is
  // outside the repo. We don't try to resolve those — git itself would
  // refuse, so treat it as "no HEAD version" too.
  if (relFile.startsWith("..") || path.isAbsolute(relFile)) {
    log.warn("get file-content out-of-repo", { file, relFile, repoRoot, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(
      { content: null, exists: false, truncated: false, ref, repoRoot },
      { status: 200 },
    );
  }

  const result = await getFileAtRef(repoRoot, ref, relFile);
  log.info("get file-content completed", {
    cwd, file: relFile, ref, repoRoot,
    exists: result.exists, truncated: result.truncated,
    bytes: result.content?.length ?? 0,
    durationMs: elapsedMs(startedAt),
  });
  return NextResponse.json({ ...result, ref, repoRoot });
}