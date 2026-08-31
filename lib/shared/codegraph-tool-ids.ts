/**
 * Tool-market ids for the CodeGraph tool family. Kept in a separate shared
 * module so the server registry (`lib/server/rpc-manager.ts`) can gate the
 * whole family with one check without pulling in the full tool-market
 * definitions.
 */
export const CODEGRAPH_TOOL_IDS = [
  "codegraph_status",
  "codegraph_search",
  "codegraph_explore",
  "codegraph_node",
  "codegraph_callers",
  "codegraph_callees",
  "codegraph_impact",
  "codegraph_files",
  "codegraph_build",
] as const;

export type CodeGraphToolId = (typeof CODEGRAPH_TOOL_IDS)[number];