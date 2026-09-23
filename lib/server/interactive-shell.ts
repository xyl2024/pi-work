/**
 * Server-side adapter for the interactive shell decision: hands the current
 * process's platform and environment to the pure module in
 * `lib/shared/interactive-shell.ts`, and answers the one thing a pure module
 * cannot — where an executable actually lives.
 *
 * Both consumers go through here: the terminal panel (`lib/server/terminal`)
 * spawns `currentInteractiveShell()`, the status bar prints
 * `currentInteractiveShellName()`. Nothing else may decide this.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolveInteractiveShell, shellDisplayName } from "@/lib/shared/interactive-shell";

/** Resolved once per process: the shell a machine offers does not change mid-run. */
let cached: string | null = null;

/** The shell an interactive terminal panel should spawn. */
export function currentInteractiveShell(): string {
  cached ??= resolveInteractiveShell({
    platform: process.platform,
    env: process.env,
    findCommand,
  });
  return cached;
}

/** The short name for that shell, for display (the status bar). */
export function currentInteractiveShellName(): string {
  return shellDisplayName(currentInteractiveShell());
}

/** The absolute path of `command` on PATH, or null. (`where` on Windows, `which` elsewhere.) */
function findCommand(command: string): string | null {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const result = spawnSync(finder, [command], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout) return null;
    // `where` happily reports paths that no longer exist, so the first hit is
    // only trusted once it is confirmed to be a real file.
    const first = result.stdout.trim().split(/\r?\n/)[0]?.trim();
    return first && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}
