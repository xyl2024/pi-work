// ============================================================================
// Context composition rows (pure)
//
// The composition panel shows a bucket's leaves as *rows*, not one line per
// leaf: the system prompt has a dozen leaves (prompt prose, the tool list, the
// guidelines, one block per AGENTS.md, pi docs, append, the cwd footer) and
// listing them flat would bury the answer to "what is actually big here?".
//
// So a bucket is projected into rows:
//
//  - `system-prompt` — five rows, in the order the panel documents them: the
//    base prompt, one row per project context file, Pi documentation, Append,
//    and the current working directory. The base row is the only one that is
//    itself worth splitting, so its leaves become a second level: the prompt's
//    own prose plus the `Available tools` / `Guidelines` sections under their
//    Context-panel anchor names.
//  - the other buckets — one row per leaf (`tool:<name>` per tool schema, the
//    skills listing, the seven message roles).
//
// A row always contains whole leaves and every leaf lands in exactly one row,
// so `Σ rows.tokens === bucket.tokens` and `Σ children === row` hold by
// construction — the panel's numbers add up at every level it renders. Rows are
// derived from the already-anchored leaves, so this module never does arithmetic
// of its own beyond summing.
//
// Like `panelTabs` / `chat-timeline` / `tool-call-display` (ADR-0002 /
// ADR-0003) this module may not import React, DOM, i18n, a client hook, or
// anything from `lib/server`.
// ============================================================================

import type {
  ContextCompositionBucket,
  ContextCompositionLeafCount,
} from "./context-composition";

/** One rendered row of the composition panel. `id` is what the UI resolves to
 *  a label (`base` | `agents:<path>` | `pi-docs` | `append` | `cwd` |
 *  `available-tools` | `guidelines` | `skills` | `tool:<name>` | one of the
 *  seven message leaf ids). */
export interface ContextCompositionRow {
  id: string;
  /** The leaves this row aggregates — always at least one. */
  leaves: ContextCompositionLeafCount[];
  localTokens: number;
  tokens: number | null;
  percent: number | null;
  /** Nested rows, only present when the row is worth splitting (the base
   *  prompt). Empty means "render this row's number and nothing else". */
  children: ContextCompositionRow[];
}

/** Which system-prompt row a leaf belongs to. Project context files each get
 *  their own row (their path is the label); everything else anchors into one of
 *  the four fixed rows. Unknown ids land in the base row rather than being
 *  dropped, which is what keeps the partition exact if the segmentation ever
 *  grows an anchor. */
function systemPromptRowId(leafId: string): string {
  if (leafId === "pi-docs" || leafId === "append" || leafId === "cwd") return leafId;
  if (leafId.startsWith("agents:")) return leafId;
  return "base";
}

/** Display order of the system-prompt rows: the base prompt first, then the
 *  project files in prompt order, then the four fixed sections. */
function systemPromptRowRank(rowId: string): number {
  if (rowId === "base") return 0;
  if (rowId.startsWith("agents:")) return 1;
  if (rowId === "pi-docs") return 2;
  if (rowId === "append") return 3;
  if (rowId === "cwd") return 4;
  return 5;
}

/** Which second-level row a base-prompt leaf belongs to. The two sections the
 *  Context panel anchors keep their own names; the rest is the prompt's own
 *  prose (persona paragraph, inter-section filler). */
function baseChildRowId(leafId: string): string {
  return leafId === "available-tools" || leafId === "guidelines" ? leafId : "base";
}

/** Sum a set of leaves into a row. `tokens` / `percent` are `null` only when
 *  the leaves are unanchored (no provider total yet), never per-leaf. */
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

/** Fold leaves into rows keyed by `rowIdOf`, preserving first-encounter order. */
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

/** The system-prompt bucket's rows, with the base row split a second time. */
function systemPromptRows(leaves: ContextCompositionLeafCount[]): ContextCompositionRow[] {
  const rows = foldIntoRows(leaves, systemPromptRowId);
  rows.sort((a, b) => systemPromptRowRank(a.id) - systemPromptRowRank(b.id));
  return rows.map((row) => {
    if (row.id !== "base") return row;
    const children = foldIntoRows(row.leaves, baseChildRowId);
    // A one-child split would just repeat the parent's number; only offer the
    // second level when it actually separates two sources.
    return children.length > 1 ? { ...row, children } : row;
  });
}

/**
 * Project one bucket's leaves into the rows the composition panel renders.
 * The projection is a partition at both levels, so a row's `tokens` always
 * equals the sum of its `children` (when it has any) and of the leaves it
 * owns — the panel can render every level it shows without a "doesn't add up"
 * discrepancy.
 */
export function contextBucketRows(bucket: ContextCompositionBucket): ContextCompositionRow[] {
  if (bucket.id === "system-prompt") return systemPromptRows(bucket.leaves);
  // Every other bucket is already at display granularity: one row per leaf.
  return bucket.leaves.map((leaf) => makeRow(leaf.id, [leaf]));
}
