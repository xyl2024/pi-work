import { agentShellTools } from "../shared/agent-shell-tools";
import { SUBAGENT_DEFAULT_TOOL_IDS } from "../shared/subagent";

export const SUBAGENT_READ_ONLY_TOOLS: readonly string[] = SUBAGENT_DEFAULT_TOOL_IDS;

export function subagentTools(platform: string): readonly string[] {
  return [...SUBAGENT_READ_ONLY_TOOLS, ...agentShellTools(platform)];
}
