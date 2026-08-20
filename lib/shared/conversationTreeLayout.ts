import type { ConversationCard } from "./buildConversationTree";

export interface LayoutCard extends ConversationCard {
  /** Column index — branches diverge horizontally as this grows. */
  x: number;
  /** Row index — time flows downward. */
  y: number;
  /** How many rows this card's subtree occupies. */
  subtreeHeight: number;
}

export interface LayoutEdge {
  /** Source card id (parent). */
  fromId: string;
  /** Target card id (child). */
  toId: string;
  /** Whether the source is the parent in a user→assistant relationship. */
  isUserToAssistant: boolean;
  /** The round stats, only set on user→assistant edges. */
  roundStats: { thinking: number; toolCalls: number } | null;
}

/**
 * Group flat cards by id for O(1) child lookup. The input flat list must
 * have parentCardId pointing to another card id in the same list.
 */
function indexCards(cards: ConversationCard[]): {
  byId: Map<string, ConversationCard>;
  childrenById: Map<string, ConversationCard[]>;
} {
  const byId = new Map<string, ConversationCard>();
  const childrenById = new Map<string, ConversationCard[]>();
  for (const c of cards) byId.set(c.id, c);
  for (const c of cards) {
    const arr = childrenById.get(c.parentCardId ?? "") ?? [];
    arr.push(c);
    childrenById.set(c.parentCardId ?? "", arr);
  }
  return { byId, childrenById };
}

/**
 * Compute subtree height for a single card. The height represents the
 * vertical extent of the card's subtree in the rendered tree.
 *
 * - User card: 1 + (its one assistant child's height), or 1 if no assistant.
 * - Assistant card: 1 + max(child heights). Siblings all start at the same
 *   y, so vertical extent is bounded by the tallest sibling rather than
 *   the sum.
 */
function computeSubtreeHeight(
  card: ConversationCard,
  childrenById: Map<string, ConversationCard[]>,
  memo: Map<string, number>,
): number {
  const cached = memo.get(card.id);
  if (cached !== undefined) return cached;
  // Mark before recursing to break cycles (shouldn't happen, but defensive).
  memo.set(card.id, 0);
  const kids = childrenById.get(card.id) ?? [];
  let extra = 0;
  if (card.role === "user") {
    extra = kids.length > 0 ? computeSubtreeHeight(kids[0], childrenById, memo) : 0;
  } else {
    // assistant + compaction both fan out the same way: take the tallest
    // child's subtree, not the sum.
    let maxH = 0;
    for (const k of kids) {
      const h = computeSubtreeHeight(k, childrenById, memo);
      if (h > maxH) maxH = h;
    }
    extra = maxH;
  }
  const h = 1 + extra;
  memo.set(card.id, h);
  return h;
}

/**
 * Assign (x, y) to every card via a stable, tree-only DFS:
 *
 * - User→assistant edge: assistant sits directly below in the SAME column.
 *   This is always a 1:1 relationship (a round's user has one final
 *   assistant child) — no branching here.
 *
 * - Assistant with ONE user child: linear continuation, same column.
 *
 * - Assistant with MULTIPLE user children (a fork):
 *     - The leftmost (oldest) child keeps the parent's column (x, y+1) —
 *       this is the stable "spine" slot, decided purely from tree order
 *       (childrenById preserves pi's timestamp-ordered tree).
 *     - Younger siblings fan out to (x+1, y+1), (x+2, y+1), ... — each
 *       in its own column, all at the same row. Subtrees extend downward
 *       independently in their own columns.
 *
 * Layout positions are deliberately independent of the active leaf path,
 * so clicking a card in a different branch never moves any cards. The
 * active branch is shown by edge highlights in the rendering layer.
 * Multiple disconnected roots render as separate spines stacked vertically.
 */
function assignPositions(
  card: ConversationCard,
  x: number,
  y: number,
  heights: Map<string, number>,
  childrenById: Map<string, ConversationCard[]>,
  out: Map<string, LayoutCard>,
): void {
  const layout: LayoutCard = {
    ...card,
    x,
    y,
    subtreeHeight: heights.get(card.id) ?? 1,
  };
  out.set(card.id, layout);

  const kids = childrenById.get(card.id) ?? [];
  if (card.role === "user") {
    // A round's user card has at most one assistant child (the round's
    // final reply). Same-column continuation either way.
    if (kids.length > 0) {
      assignPositions(kids[0], x, y + 1, heights, childrenById, out);
    }
    return;
  }
  // Assistant + compaction both sit above their subtrees and fan out the
  // same way when multiple children appear.
  if (kids.length <= 1) {
    // Linear continuation: same column.
    if (kids.length === 1) {
      assignPositions(kids[0], x, y + 1, heights, childrenById, out);
    }
    return;
  }
  // Fork: kids[0] (the oldest sibling) keeps the parent's column so the
  // spine stays put regardless of which branch is active. The active
  // branch is communicated entirely by edge highlights, not by position.
  const spine = kids[0];
  assignPositions(spine, x, y + 1, heights, childrenById, out);
  let slot = 0;
  for (const k of kids) {
    if (k === spine) continue;
    assignPositions(k, x + 1 + slot, y + 1, heights, childrenById, out);
    slot++;
  }
}

export interface ConversationTreeLayout {
  cards: LayoutCard[];
  edges: LayoutEdge[];
  /** Total width in columns (= max x + 1). */
  widthCols: number;
  /** Total height in rows (= max y + 1). */
  heightRows: number;
}

/**
 * Compute a stable column layout for a flat card list.
 *
 * Column assignment depends ONLY on tree structure — at every assistant
 * fork the leftmost (oldest) child inherits the parent's column, while
 * younger siblings fan out to the right. The active leaf path plays no
 * role in positioning: clicking a different branch never moves any
 * cards. The active branch is communicated entirely by edge highlights
 * in the rendering layer.
 */
export function layoutConversationTree(
  cards: ConversationCard[],
): ConversationTreeLayout {
  if (cards.length === 0) {
    return { cards: [], edges: [], widthCols: 0, heightRows: 0 };
  }
  const { byId, childrenById } = indexCards(cards);
  const heights = new Map<string, number>();
  const roots = cards.filter((c) => c.parentCardId === null);

  // Compute heights bottom-up from roots.
  for (const r of roots) computeSubtreeHeight(r, childrenById, heights);

  const out = new Map<string, LayoutCard>();
  let y = 0;
  for (const r of roots) {
    assignPositions(r, 0, y, heights, childrenById, out);
    y += heights.get(r.id) ?? 1;
  }

  // Build edges.
  const edges: LayoutEdge[] = [];
  for (const card of cards) {
    if (!card.parentCardId) continue;
    const parent = byId.get(card.parentCardId);
    if (!parent) continue;
    edges.push({
      fromId: card.parentCardId,
      toId: card.id,
      isUserToAssistant: parent.role === "user" && card.role === "assistant",
      roundStats: parent.role === "user" ? parent.roundStats : null,
    });
  }

  const cardsOut = Array.from(out.values());
  const widthCols = cardsOut.reduce((m, c) => Math.max(m, c.x + 1), 0);
  const heightRows = cardsOut.reduce((m, c) => Math.max(m, c.y + 1), 0);
  return { cards: cardsOut, edges, widthCols, heightRows };
}