import type {
  ContextCompositionBucket,
  ContextCompositionLeafCount,
} from "./context-composition";

export interface ContextCompositionRow {
  id: string;
  leaves: ContextCompositionLeafCount[];
  localTokens: number;
  tokens: number | null;
  percent: number | null;
  children: ContextCompositionRow[];
}

function systemPromptRowId(leafId: string): string {
  if (leafId === "pi-docs" || leafId === "append" || leafId === "cwd") return leafId;
  if (leafId.startsWith("agents:")) return leafId;
  return "base";
}

function systemPromptRowRank(rowId: string): number {
  if (rowId === "base") return 0;
  if (rowId.startsWith("agents:")) return 1;
  if (rowId === "pi-docs") return 2;
  if (rowId === "append") return 3;
  if (rowId === "cwd") return 4;
  return 5;
}

function baseChildRowId(leafId: string): string {
  return leafId === "available-tools" || leafId === "guidelines" ? leafId : "base";
}

function makeRow(id: string, leaves: ContextCompositionLeafCount[]): ContextCompositionRow {
  const unanchored = leaves.some((leaf) => leaf.tokens === null || leaf.percent === null);
  return {
    id,
    leaves,
    localTokens: leaves.reduce((sum, leaf) => sum + leaf.localTokens, 0),
    tokens: unanchored ? null : leaves.reduce((sum, leaf) => sum + (leaf.tokens ?? 0), 0),
    percent: unanchored ? null : leaves.reduce((sum, leaf) => sum + (leaf.percent ?? 0), 0),
    children: [],
  };
}

function foldIntoRows(
  leaves: ContextCompositionLeafCount[],
  rowIdOf: (leafId: string) => string,
): ContextCompositionRow[] {
  const buckets = new Map<string, ContextCompositionLeafCount[]>();
  for (const leaf of leaves) {
    const rowId = rowIdOf(leaf.id);
    const existing = buckets.get(rowId);
    if (existing) existing.push(leaf);
    else buckets.set(rowId, [leaf]);
  }
  return [...buckets].map(([rowId, rowLeaves]) => makeRow(rowId, rowLeaves));
}

function systemPromptRows(leaves: ContextCompositionLeafCount[]): ContextCompositionRow[] {
  const rows = foldIntoRows(leaves, systemPromptRowId);
  rows.sort((a, b) => systemPromptRowRank(a.id) - systemPromptRowRank(b.id));
  return rows.map((row) => {
    if (row.id !== "base") return row;
    const children = foldIntoRows(row.leaves, baseChildRowId);
    return children.length > 1 ? { ...row, children } : row;
  });
}

export function contextBucketRows(bucket: ContextCompositionBucket): ContextCompositionRow[] {
  if (bucket.id === "system-prompt") return systemPromptRows(bucket.leaves);
  return bucket.leaves.map((leaf) => makeRow(leaf.id, [leaf]));
}
