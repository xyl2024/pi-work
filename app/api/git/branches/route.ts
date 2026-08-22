import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getRepoRoot } from "@/lib/server/git-diff";
import { getBranchList } from "@/lib/server/git-log";

export const dynamic = "force-dynamic";

const log = createLogger("api/git/branches");

// GET /api/git/branches?cwd=<path>
// Returns the repo's head branches (most recently committed first) for the
// GitPanel header dropdown. Same cwd-trust rationale as /api/git: session
// cwd already validated at creation, response carries only branch names.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const startedAt = Date.now();

  if (!cwd) {
    log.warn("get git branches rejected", { reason: "missing cwd", durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "cwd required" }, { status: 400 });
  }

  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) {
    return NextResponse.json({ branches: [] }, { status: 200 });
  }

  const branches = await getBranchList(repoRoot);
  log.info("get git branches completed", {
    cwd, repoRoot, branchCount: branches.length, durationMs: elapsedMs(startedAt),
  });

  return NextResponse.json({ branches });
}