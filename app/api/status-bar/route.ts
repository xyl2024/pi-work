import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { getRepoStatus } from "@/lib/server/git-diff";
import { summarize, summarizeSessions } from "@/lib/server/token-audit-store";
import { listChannels } from "@/lib/server/channels";
import { currentInteractiveShellName } from "@/lib/server/interactive-shell";
import { listDescendantSubagentSessionIds } from "@/lib/server/subagent-store";

export const dynamic = "force-dynamic";

function getLinuxDistribution(): string | null {
  try {
    const content = readFileSync("/etc/os-release", "utf8");
    const match = content.match(/^NAME=(.*)$/m) ?? content.match(/^PRETTY_NAME=(.*)$/m);
    if (!match) return null;

    const value = match[1].trim().replace(/^("|')(.*)\1$/, "$2").trim();
    return value || null;
  } catch {
    return null;
  }
}

function getOsName(): string {
  switch (process.platform) {
    case "win32": return "Windows";
    case "darwin": return "macOS";
    case "linux": return getLinuxDistribution() ?? "Linux";
    default: return process.platform;
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const cwd = params.get("cwd");
  const sessionId = params.get("sessionId")?.trim() || null;

  let git: { branch: string | null; changedFiles: number; additions: number; deletions: number } = {
    branch: null,
    changedFiles: 0,
    additions: 0,
    deletions: 0,
  };

  if (cwd) {
    try {
      const status = await getRepoStatus(cwd);
      const additions = status.files.reduce((sum, f) => sum + f.additions, 0);
      const deletions = status.files.reduce((sum, f) => sum + f.deletions, 0);
      git = { branch: status.branch, changedFiles: status.files.length, additions, deletions };
    } catch {
    }
  }

  const tokenTotals = summarize("today", "none").totals;
  const activeChannels = listChannels().filter((c) => c.status === "connected").length;

  let session: ReturnType<typeof summarizeSessions> | null = null;
  if (sessionId) {
    let subagentSessionIds: string[] = [];
    try {
      subagentSessionIds = listDescendantSubagentSessionIds(sessionId);
    } catch {
    }
    session = summarizeSessions([sessionId, ...subagentSessionIds]);
  }

  return NextResponse.json({
    os: getOsName(),
    shell: currentInteractiveShellName(),
    channels: activeChannels,
    git,
    today: {
      tokens: tokenTotals.inputTokens + tokenTotals.outputTokens + tokenTotals.cacheReadTokens + tokenTotals.cacheWriteTokens,
      cost: tokenTotals.costTotal,
    },
    session,
  });
}
