/**
 * Which interactive shell this machine opens — the one decision behind both
 * the terminal panel (the pty it spawns) and the status bar (the name it
 * prints). Two copies of it drifted apart once already: both read
 * `COMSPEC ?? "powershell.exe"` on Windows, and `COMSPEC` is `cmd.exe` on
 * virtually every Windows box, so the PowerShell fallback was dead code and
 * both consumers would have kept answering "cmd.exe" forever.
 *
 * Windows resolves in the order PowerShell 7 → Windows PowerShell → the
 * `COMSPEC` floor, matching what pi's `powershell` tool does with
 * `pwsh.exe`/`powershell.exe`. `cmd.exe` is only reached when even `COMSPEC`
 * is unset, i.e. on a machine where nothing else can be spawned at all.
 *
 * The platform, the environment and the PATH lookup all arrive as explicit
 * arguments — this module never reads `process.platform` and never touches the
 * filesystem (ADR-0003 rule 3), which is what lets the Windows branch be
 * unit-tested from Linux. The server-side adapter that supplies the real
 * values is `lib/server/interactive-shell.ts`.
 */

export interface InteractiveShellInput {
  /** `process.platform` of the machine that will run the shell. */
  platform: string;
  /** `process.env`-shaped map: `SHELL` on POSIX, `COMSPEC` on Windows. */
  env: Record<string, string | undefined>;
  /** Absolute path of `command` when it is on PATH, otherwise null. */
  findCommand: (command: string) => string | null;
}

/** PowerShell executables, most-preferred first — the order pi's tool uses. */
const WINDOWS_POWERSHELL_CANDIDATES = ["pwsh.exe", "powershell.exe"];

/** The shell to spawn for an interactive session on the given platform. */
export function resolveInteractiveShell({
  platform,
  env,
  findCommand,
}: InteractiveShellInput): string {
  if (platform === "win32") {
    for (const candidate of WINDOWS_POWERSHELL_CANDIDATES) {
      const found = findCommand(candidate);
      if (found) return found;
    }
    return env.COMSPEC || "cmd.exe";
  }
  return env.SHELL || "bash";
}

/**
 * The short name to show for a shell — the last path segment, without needing
 * `node:path` (this module stays importable from anywhere).
 */
export function shellDisplayName(shell: string): string {
  const segments = shell.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? shell;
}
