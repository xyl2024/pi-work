import { unavailableAgentShellTools } from "../shared/agent-shell-tools";

/**
 * pi built-ins this product does not ship: the search-and-list trio. `read`
 * keeps its job (file contents by line range); `grep` / `find` / `ls` are the
 * three tools whose jobs `bash` already covers through `grep -rn` / `find` /
 * `ls`, in a shell the agent always has, so they are removed from the registry
 * rather than hidden in the picker (ADR-0015).
 */
const REMOVED_AGENT_TOOL_NAMES: readonly string[] = ["grep", "find", "ls"];

/**
 * The registry denylist for a session started on `platform`: the pi built-ins
 * that must never enter the tool registry, for either of two reasons — this
 * platform cannot run them (`lib/shared/agent-shell-tools.ts`), or the product
 * does not ship them (above).
 *
 * `rpc-manager` hands this to `createAgentSession`'s `excludeTools`. Denying at
 * the registry (rather than only hiding rows in the picker) is what keeps
 * `get_tools`, the tool picker and an "all tools" selection in agreement: an
 * excluded name is absent from all three, and a stale name in a saved tool
 * selection or subagent profile expands to nothing instead of becoming
 * reachable again.
 */
export function agentToolDenylist(platform: string): readonly string[] {
  return [...unavailableAgentShellTools(platform), ...REMOVED_AGENT_TOOL_NAMES];
}
