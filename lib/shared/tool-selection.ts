import type { ToolSelection } from "./types";

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

export interface ToolGroup {
  id: string;
  pattern: string;
  prefix: string;
}

export const TOOL_GROUPS: readonly ToolGroup[] = [];

export function toolGroupFor(name: string): ToolGroup | undefined {
  return TOOL_GROUPS.find((group) => name.startsWith(group.prefix));
}

export interface ToolChecklistRow {
  key: string;
  name: string;
  group: ToolGroup | null;
  memberCount: number;
  description: string | null;
}

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

export function isDeclarableTool(tool: { exposure?: string }): boolean {
  return tool.exposure === undefined || tool.exposure === "direct" || tool.exposure === "model-only";
}

export function declarableToolNames(
  tools: readonly { name: string; exposure?: string }[],
): string[] {
  return tools.filter(isDeclarableTool).map((tool) => tool.name);
}

export function expandToolSelection(selection: ToolSelection, allToolNames: readonly string[]): ToolSelection {
  if (selection === "all") return "all";
  return expandToolPatterns(selection, allToolNames);
}
