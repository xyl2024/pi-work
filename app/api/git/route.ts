import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getRepoStatus } from "@/lib/server/git-diff";

export const dynamic = "force-dynamic";

const log = createLogger("api/git");

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const force = searchParams.get("force") === "1";
  const startedAt = Date.now();

  if (!cwd) {
    log.warn("get git status rejected", { reason: "missing cwd", durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: "cwd required" }, { status: 400 });
  }

  const status = await getRepoStatus(cwd, { force });
  log.info("get git status completed", {
    cwd,
    repoRoot: status.repoRoot,
    branch: status.branch,
    fileCount: status.files.length,
    durationMs: elapsedMs(startedAt),
  });

  return NextResponse.json(status);
}
