const BASH_TOOL_NAME = "bash";
const POWERSHELL_TOOL_NAME = "powershell";

export const AGENT_SHELL_TOOL_NAMES: readonly string[] = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME];

export function agentShellTools(platform: string): readonly string[] {
  return platform === "win32" ? [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME] : [BASH_TOOL_NAME];
}

export function unavailableAgentShellTools(platform: string): readonly string[] {
  const available = agentShellTools(platform);
  return AGENT_SHELL_TOOL_NAMES.filter((name) => !available.includes(name));
}
