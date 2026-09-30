import { agentShellTools } from "../shared/agent-shell-tools";
import { SUBAGENT_DEFAULT_CODEGRAPH_TOOL_IDS, SUBAGENT_DEFAULT_TOOL_IDS } from "../shared/subagent";

/**
 * The default tool set a subagent profile is seeded with. Lives apart from
 * `subagent-tool.ts` so the profile store can seed built-ins without importing
 * the tool definition (and so the default is unit-testable on its own).
 *
 * `codegraph_build` is deliberately excluded from this *default*: it is the one
 * CodeGraph tool gated behind a user confirmation, and a subagent session has
 * no UI surface to answer one (see
 * docs/adr/0001-subagent-toolsets-must-not-need-a-permission-prompt.md).
 * Profiles are user-editable, so a user *can* add it back — doing so makes the
 * child fail on that call rather than prompt.
 */
export const SUBAGENT_CODEGRAPH_TOOLS: readonly string[] = SUBAGENT_DEFAULT_CODEGRAPH_TOOL_IDS;

/**
 * Read-only exploration tools the default profile gets, on every platform.
 * The shells are NOT part of this list: which shell a machine has is one
 * platform decision (`lib/shared/agent-shell-tools.ts`), composed in by
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
