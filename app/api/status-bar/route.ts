import { NextResponse } from "next/server";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { getRepoStatus } from "@/lib/server/git-diff";
import { summarize } from "@/lib/server/token-audit-store";

export const dynamic = "force-dynamic";

function getServerIp(): string {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const address of interfaces ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return "127.0.0.1";
}

function getLinuxDistribution(): string | null {
  try {
    const content = readFileSync("/etc/os-release", "utf8");
    const match = content.match(/^PRETTY_NAME=(.*)$/m) ?? content.match(/^NAME=(.*)$/m);
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

function getShellName(): string {
  const shell = process.platform === "win32"
    ? process.env.COMSPEC ?? "powershell.exe"
    : process.env.SHELL ?? "bash";
  return path.basename(shell);
}

export async function GET(request: Request) {
  const cwd = new URL(request.url).searchParams.get("cwd");
  let git: { branch: string | null; changedFiles: number } = {
    branch: null,
    changedFiles: 0,
  };

  if (cwd) {
    try {
      const status = await getRepoStatus(cwd);
      git = { branch: status.branch, changedFiles: status.files.length };
    } catch {
      // A cwd may no longer exist or may not be a Git repository.
    }
  }

  const tokenTotals = summarize("today", "none").totals;
  return NextResponse.json({
    os: getOsName(),
    shell: getShellName(),
    ip: getServerIp(),
    git,
    today: {
      tokens: tokenTotals.inputTokens + tokenTotals.outputTokens + tokenTotals.cacheReadTokens + tokenTotals.cacheWriteTokens,
      cost: tokenTotals.costTotal,
    },
  });
}
