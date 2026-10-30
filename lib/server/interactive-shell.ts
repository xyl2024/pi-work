import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolveInteractiveShell, shellDisplayName } from "@/lib/shared/interactive-shell";

let cached: string | null = null;

export function currentInteractiveShell(): string {
  cached ??= resolveInteractiveShell({
    platform: process.platform,
    env: process.env,
    findCommand,
  });
  return cached;
}

export function currentInteractiveShellName(): string {
  return shellDisplayName(currentInteractiveShell());
}

function findCommand(command: string): string | null {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const result = spawnSync(finder, [command], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout) return null;
    const first = result.stdout.trim().split(/\r?\n/)[0]?.trim();
    return first && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}
