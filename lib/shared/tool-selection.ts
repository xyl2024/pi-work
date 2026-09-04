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
 * Tool families that the UI binds into a single switch: every member of a
 * family is toggled on/off together (one checklist row per family instead of
 * one row per tool). `pattern` is the `*`-suffixed prefix pattern stored in
 * a ToolSelection when the family is enabled; `prefix` matches member names.
 *
 * Rationale: a family's tools are only useful together (e.g. every
 * `codegraph_*` tool queries the same index and shares usage guidelines in
 * the appended system prompt), so partial enablement just degrades behavior.
 */
export interface ToolGroup {
  id: string;
  pattern: string;
  prefix: string;
}

export const TOOL_GROUPS: readonly ToolGroup[] = [
  { id: "codegraph", pattern: "codegraph_*", prefix: "codegraph_" },
];

/** The bound group a tool name belongs to, or undefined for a standalone tool. */
export function toolGroupFor(name: string): ToolGroup | undefined {
  return TOOL_GROUPS.find((group) => name.startsWith(group.prefix));
}

/** One row of a tool checklist: a standalone tool or a collapsed bound group. */
export interface ToolChecklistRow {
  /** Stable React key: concrete tool name or the group's `*` pattern. */
  key: string;
  /** What a toggle operates on: concrete tool name or the group pattern. */
  name: string;
  /** The bound group this row collapses, or null for a standalone tool. */
  group: ToolGroup | null;
  /** Number of member tools (0 for standalone rows). */
  memberCount: number;
  /** Standalone tool description, or the group row's rendered description. */
  description: string | null;
}

/**
 * Collapse a tool catalog into checklist rows: members of each bound group
 * (TOOL_GROUPS) merge into a single row keyed by the group's `*` pattern, so
 * the family is shown — and toggled — as one switch instead of one checkbox
 * per tool. `groupDescription` renders the group row's description (receives
 * the member count, e.g. via i18n).
 */
export function buildToolChecklistRows(
  tools: readonly { name: string; description?: string | null }[],
  groupDescription: (memberCount: number) => string,
): ToolChecklistRow[] {
  const rows: ToolChecklistRow[] = [];
  const emitted = new Set<string>();
  for (const tool of tools) {
    const group = toolGroupFor(tool.name);
    if (!group) {
      rows.push({ key: tool.name, name: tool.name, group: null, memberCount: 0, description: tool.description ?? null });
      continue;
    }
    if (emitted.has(group.id)) continue;
    emitted.add(group.id);
    rows.push({
      key: group.pattern,
      name: group.pattern,
      group,
      memberCount: tools.filter((t) => t.name.startsWith(group.prefix)).length,
      description: groupDescription(tools.filter((t) => t.name.startsWith(group.prefix)).length),
    });
  }
  return rows;
}

/**
 * Whether a checklist row (standalone tool or bound group) is checked.
 * `selected` is the EXPANDED set of concrete names currently enabled. A group
 * row is checked when any member is enabled (covers the pattern-expansion
 * case and legacy partially-enabled selections alike).
 */
export function isToolChecklistRowChecked(
  row: ToolChecklistRow,
  selected: ReadonlySet<string>,
  allToolNames: readonly string[],
): boolean {
  if (row.group) {
    return allToolNames.some((n) => n.startsWith(row.group!.prefix) && selected.has(n));
  }
  return selected.has(row.name);
}

/**
 * Compute the next raw selection after toggling one checklist row. `raw` is
 * the current selection with the "all" sentinel materialized to concrete
 * names; `*` patterns may be present. Standalone tools flip a single name
 * (replacing a covering pattern with its concrete members minus the toggled
 * name, so the rest of that family stays enabled); a bound-group toggle
 * rewrites the whole family via the group's `*` pattern, so the family is
 * always fully on or fully off.
 */
export function toggleSelectionEntry(
  raw: readonly string[],
  name: string,
  willBeChecked: boolean,
  allToolNames: readonly string[],
): string[] {
  const group = toolGroupFor(name);
  if (group) {
    const members = allToolNames.filter((n) => n.startsWith(group.prefix));
    const rest = raw.filter((entry) => entry !== group.pattern && !members.includes(entry));
    return willBeChecked ? [...rest, group.pattern] : rest;
  }
  const next = new Set<string>(raw);
  if (willBeChecked) {
    next.add(name);
    return Array.from(next);
  }
  next.delete(name);
  // The toggled name may be covered by a prefix pattern rather than listed
  // directly: replace each covering pattern with its concrete members minus
  // the toggled name.
  for (const entry of raw) {
    if (typeof entry !== "string" || !entry.endsWith("*")) continue;
    const prefix = entry.slice(0, -1);
    if (!name.startsWith(prefix)) continue;
    next.delete(entry);
    for (const n of allToolNames) {
      if (n.startsWith(prefix) && n !== name) next.add(n);
    }
  }
  return Array.from(next);
}

/**
 * Expand a full ToolSelection ("all" passes through untouched; arrays get
 * their `*` patterns resolved against `allToolNames`).
 */
export function expandToolSelection(selection: ToolSelection, allToolNames: readonly string[]): ToolSelection {
  if (selection === "all") return "all";
  return expandToolPatterns(selection, allToolNames);
}
