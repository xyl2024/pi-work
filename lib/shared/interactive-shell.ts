export interface InteractiveShellInput {
  platform: string;
  env: Record<string, string | undefined>;
  findCommand: (command: string) => string | null;
}

const WINDOWS_POWERSHELL_CANDIDATES = ["pwsh.exe", "powershell.exe"];

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

export function shellDisplayName(shell: string): string {
  const segments = shell.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? shell;
}
