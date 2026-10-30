import type { ConversationCard } from "./buildConversationTree";

export interface LayoutCard extends ConversationCard {
  x: number;
  y: number;
  subtreeHeight: number;
}

export interface LayoutEdge {
  fromId: string;
  toId: string;
  isUserToAssistant: boolean;
  roundStats: { thinking: number; toolCalls: number } | null;
}

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

function computeSubtreeHeight(
  card: ConversationCard,
  childrenById: Map<string, ConversationCard[]>,
  memo: Map<string, number>,
): number {
  const cached = memo.get(card.id);
  if (cached !== undefined) return cached;
  memo.set(card.id, 0);
  const kids = childrenById.get(card.id) ?? [];
  let extra = 0;
  if (card.role === "user") {
    extra = kids.length > 0 ? computeSubtreeHeight(kids[0], childrenById, memo) : 0;
  } else {
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
    if (kids.length > 0) {
      assignPositions(kids[0], x, y + 1, heights, childrenById, out);
    }
    return;
  }
  if (kids.length <= 1) {
    if (kids.length === 1) {
      assignPositions(kids[0], x, y + 1, heights, childrenById, out);
    }
    return;
  }
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
  widthCols: number;
  heightRows: number;
}

export function layoutConversationTree(
  cards: ConversationCard[],
): ConversationTreeLayout {
  if (cards.length === 0) {
    return { cards: [], edges: [], widthCols: 0, heightRows: 0 };
  }
  const { byId, childrenById } = indexCards(cards);
  const heights = new Map<string, number>();
  const roots = cards.filter((c) => c.parentCardId === null);

  for (const r of roots) computeSubtreeHeight(r, childrenById, heights);

  const out = new Map<string, LayoutCard>();
  let y = 0;
  for (const r of roots) {
    assignPositions(r, 0, y, heights, childrenById, out);
    y += heights.get(r.id) ?? 1;
  }

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