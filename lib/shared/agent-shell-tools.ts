/**
 * Which shells the *agent* gets on which platform — the one place that decides
 * it, for the two consumers that need the answer:
 *
 *   - `rpc-manager` hands `unavailableAgentShellTools(platform)` to
 *     `createAgentSession`'s `excludeTools`, so a shell this machine cannot run
 *     never enters the tool registry. pi's `getPowerShellConfig()` throws off
 *     Windows, which means offering `powershell` there only lets the model pick
 *     a tool that ends the turn with an exception;
 *   - the subagent profiles take `agentShellTools(platform)` as their shell
 *     half, so a child session keeps a shell on every platform.
 *
 * `bash` is on every platform: on Windows pi resolves Git Bash itself. Its tool
 * name, description and prompt snippet all say bash, so its shell is never
 * pointed at PowerShell (a model told "bash" writes bash syntax).
 *
 * Windows is taken to have PowerShell, not probed for it — the same precondition
 * pi's own `powershell` tool has. A Windows box with neither `pwsh.exe` nor
 * `powershell.exe` on PATH is the one case where the tool is listed and still
 * fails at execution time.
 *
 * The platform arrives as an explicit argument — this module never reads
 * `process.platform` (ADR-0003 rule 3), which is what lets the Windows branch
 * be unit-tested from Linux.
 */
const BASH_TOOL_NAME = "bash";
const POWERSHELL_TOOL_NAME = "powershell";

/** Every shell tool pi's built-in registry knows about. */
export const AGENT_SHELL_TOOL_NAMES: readonly string[] = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME];

/** The shells the agent may use on `platform`. */
export function agentShellTools(platform: string): readonly string[] {
  return platform === "win32" ? [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME] : [BASH_TOOL_NAME];
}

/** The shells `platform` does not have: the registry denylist for it. */
export function unavailableAgentShellTools(platform: string): readonly string[] {
  const available = agentShellTools(platform);
  return AGENT_SHELL_TOOL_NAMES.filter((name) => !available.includes(name));
}
