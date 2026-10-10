import { agentShellTools } from "../shared/agent-shell-tools";
import { SUBAGENT_DEFAULT_TOOL_IDS } from "../shared/subagent";

/**
 * Read-only exploration tools the default profile gets, on every platform.
 * Lives apart from `subagent-tool.ts` so the profile store can seed built-ins
 * without importing the tool definition (and so the default is unit-testable
 * on its own). The shells are NOT part of this list: which shell a machine has
 * is one platform decision (`lib/shared/agent-shell-tools.ts`), composed in by
 * `subagentTools` below.
 */
export const SUBAGENT_READ_ONLY_TOOLS: readonly string[] = SUBAGENT_DEFAULT_TOOL_IDS;

/**
 * The tool set a default subagent profile is created with on `platform`: the
 * shared read-only core plus the shells that platform actually has.
 */
export function subagentTools(platform: string): readonly string[] {
  return [...SUBAGENT_READ_ONLY_TOOLS, ...agentShellTools(platform)];
}
