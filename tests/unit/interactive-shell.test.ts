import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInteractiveShell, shellDisplayName } from "@/lib/shared/interactive-shell";

/** PATH probe that finds nothing. */
const nothingOnPath = () => null;

/** PATH probe that finds exactly the listed executables, at a fake install path. */
function onPath(...commands: string[]): (command: string) => string | null {
  const found = new Set(commands);
  return (command) => (found.has(command) ? `C:\\fake\\${command}` : null);
}

const CMD = "C:\\Windows\\System32\\cmd.exe";

describe("resolveInteractiveShell", () => {
  it("prefers pwsh.exe on Windows when it is on PATH", () => {
    const shell = resolveInteractiveShell({
      platform: "win32",
      env: { COMSPEC: CMD },
      findCommand: onPath("pwsh.exe", "powershell.exe"),
    });

    expect(shell).toBe("C:\\fake\\pwsh.exe");
  });

  it("falls back to powershell.exe when pwsh is missing", () => {
    const shell = resolveInteractiveShell({
      platform: "win32",
      env: { COMSPEC: CMD },
      findCommand: onPath("powershell.exe"),
    });

    expect(shell).toBe("C:\\fake\\powershell.exe");
  });

  it("falls back to COMSPEC when neither PowerShell is on PATH", () => {
    const shell = resolveInteractiveShell({
      platform: "win32",
      env: { COMSPEC: CMD },
      findCommand: nothingOnPath,
    });

    expect(shell).toBe(CMD);
  });

  it("uses cmd.exe only when COMSPEC is missing as well", () => {
    const shell = resolveInteractiveShell({
      platform: "win32",
      env: {},
      findCommand: nothingOnPath,
    });

    expect(shell).toBe("cmd.exe");
  });

  it("keeps SHELL on Linux", () => {
    const shell = resolveInteractiveShell({
      platform: "linux",
      env: { SHELL: "/usr/bin/fish" },
      findCommand: nothingOnPath,
    });

    expect(shell).toBe("/usr/bin/fish");
  });

  it("falls back to bash on Linux when SHELL is unset", () => {
    const shell = resolveInteractiveShell({ platform: "linux", env: {}, findCommand: nothingOnPath });

    expect(shell).toBe("bash");
  });

  it("never probes PATH off Windows", () => {
    const shell = resolveInteractiveShell({
      platform: "linux",
      env: { SHELL: "/bin/zsh" },
      findCommand: () => {
        throw new Error("the probe must not run off Windows");
      },
    });

    expect(shell).toBe("/bin/zsh");
  });
});

describe("shellDisplayName", () => {
  it("keeps a bare command name", () => {
    expect(shellDisplayName("bash")).toBe("bash");
  });

  it("takes the last segment of a POSIX path", () => {
    expect(shellDisplayName("/usr/bin/fish")).toBe("fish");
  });

  it("takes the last segment of a Windows path", () => {
    expect(
      shellDisplayName("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
    ).toBe("powershell.exe");
  });
});

/**
 * The acceptance criterion this file cannot express as a function call is
 * "one implementation, read by both the terminal panel and the status bar".
 * Both consumers live in server modules that cannot be imported here without
 * dragging in SQLite and the pi SDK, so the rule is pinned at the source level
 * instead (same approach as `codegraph-externals.test.ts`): each of them must
 * delegate the decision to the shared module, and neither may keep a local
 * copy of the Windows fallback.
 */
describe("interactive shell decision has one implementation", () => {
  const consumers = ["app/api/status-bar/route.ts", "lib/server/terminal/server.ts"];

  it.each(consumers)("%s reads the shared module", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");

    expect(source).toContain("@/lib/server/interactive-shell");
  });

  it.each(consumers)("%s keeps no local copy of the shell fallback", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");

    expect(source).not.toContain("COMSPEC");
  });
});
