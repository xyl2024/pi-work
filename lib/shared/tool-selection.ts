// Pure helpers for ToolSelection handling. Shared by client (preset pickers)
// and server (rpc-manager) — must stay free of Node APIs (see lib/shared rules).

import type { ToolSelection } from "./types";

/**
 * Expand a list of tool name patterns into concrete tool names.
 *
 * Entries ending with `*` are treated as prefix patterns (e.g. `codegraph_*`
 * matches every tool whose name starts with `codegraph_`); other entries are
 * kept as-is (unknown names are filtered by the caller, mirroring pi's
 * `setActiveToolsByName` which silently ignores unknown names).
 * Duplicates are removed, first occurrence wins.
 */
export function expandToolPatterns(patterns: readonly string[], allToolNames: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of patterns) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (entry.endsWith("*")) {
      const prefix = entry.slice(0, -1);
      for (const name of allToolNames) {
        if (name.startsWith(prefix) && !out.includes(name)) out.push(name);
      }
    } else if (!out.includes(entry)) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Expand a full ToolSelection ("all" passes through untouched; arrays get
 * their `*` patterns resolved against `allToolNames`).
 */
export function expandToolSelection(selection: ToolSelection, allToolNames: readonly string[]): ToolSelection {
  if (selection === "all") return "all";
  return expandToolPatterns(selection, allToolNames);
}
