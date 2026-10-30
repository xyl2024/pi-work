import { unavailableAgentShellTools } from "../shared/agent-shell-tools";

const REMOVED_AGENT_TOOL_NAMES: readonly string[] = ["grep", "find", "ls"];

export function agentToolDenylist(platform: string): readonly string[] {
  return [...unavailableAgentShellTools(platform), ...REMOVED_AGENT_TOOL_NAMES];
}
