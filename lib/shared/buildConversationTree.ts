import type { AgentMessage, CompactionEntry, CompactionUsage, SessionEntry, SessionTreeNode } from "./types";
import {
  countAssistantBlocks,
  countImages,
  extractMessageText,
} from "./extractCardText";

export type CardRole = "user" | "assistant" | "compaction";

/** Summary fields attached to a compaction card so the tree-panel
 *  divider can render the "Compacted from N tokens" header without
 *  re-parsing `card.text`. */
export interface CompactionCardMeta {
  tokensBefore: number;
  firstKeptEntryId: string;
  summary: string;
  usage?: CompactionUsage;
}

export interface ConversationCard {
  /** SessionEntry.id — used as React key, for active-path lookup, for click → scroll. */
  id: string;
  role: CardRole;
  /** Truncation-free source text — CSS line-clamp handles truncation at render. Empty string is valid (renders an empty card). */
  text: string;
  imageCount: number;
  /**
   * Populated on user cards only. Counts thinking + toolCall blocks across
   * all assistant messages in the round (down to the next user message in
   * the same branch). null on assistant cards.
   */
  roundStats: { thinking: number; toolCalls: number } | null;
  /** Card-id of the parent card in the card tree (null for root). */
  parentCardId: string | null;
  /** Underlying entry timestamp — kept for tooltip display. */
  timestamp: string;
  /** The raw entry id (== id), surfaced for tooltip context. */
  entryId: string;
  /** Compaction-only metadata. Undefined on user/assistant cards. */
  compaction?: CompactionCardMeta;
}

export interface ConversationTree {
  cards: ConversationCard[];
  /** Entry ids of cards on the active leaf path. */
  activePathIds: Set<string>;
}

interface RawNodeIndex {
  byId: Map<string, SessionTreeNode>;
  childrenById: Map<string, SessionTreeNode[]>;
}

function indexRawTree(roots: SessionTreeNode[]): RawNodeIndex {
  const byId = new Map<string, SessionTreeNode>();
  const childrenById = new Map<string, SessionTreeNode[]>();

  const walk = (n: SessionTreeNode) => {
    byId.set(n.entry.id, n);
    const kids: SessionTreeNode[] = [];
    for (const c of n.children) {
      kids.push(c);
      walk(c);
    }
    childrenById.set(n.entry.id, kids);
  };

  for (const r of roots) walk(r);
  return { byId, childrenById };
}

function messageFromEntry(entry: SessionEntry): AgentMessage | null {
  if (entry.type !== "message") return null;
  return entry.message;
}

function entryRole(entry: SessionEntry): CardRole | null {
  const m = messageFromEntry(entry);
  if (!m) {
    // Compaction entries don't carry a `message` field but still produce
    // a card — they sit between rounds as a divider. Other entry types
    // (toolResult / model_change / label / branch_summary / custom /
    // custom_message / thinking_level_change / session_info) stay
    // transparent.
    if (entry.type === "compaction") return "compaction";
    return null;
  }
  if (m.role === "user") return "user";
  if (m.role === "assistant") return "assistant";
  return null;
}

/**
 * For every user entry in the tree, find its round's final assistant entry
 * (down through toolResult / model_change / etc., stopping at the next user
 * entry in the same branch). Also accumulates the round's thinking +
 * toolCall counts.
 */
function precomputeRounds(
  index: RawNodeIndex,
): Map<string, { finalAssistantId: string | null; stats: { thinking: number; toolCalls: number } }> {
  const rounds = new Map<
    string,
    { finalAssistantId: string | null; stats: { thinking: number; toolCalls: number } }
  >();
  for (const [userEntryId, node] of index.byId) {
    if (entryRole(node.entry) !== "user") continue;
    let cursor = userEntryId;
    let lastAssistantId: string | null = null;
    let thinking = 0;
    let toolCalls = 0;
    while (true) {
      const kids = index.childrenById.get(cursor) ?? [];
      if (kids.length === 0) break;
      const next = kids[0];
      const role = entryRole(next.entry);
      if (role === "user") break; // next round starts here
      if (role === "assistant") {
        lastAssistantId = next.entry.id;
        const aMsg = messageFromEntry(next.entry);
        if (aMsg) {
          const stats = countAssistantBlocks(aMsg);
          thinking += stats.thinking;
          toolCalls += stats.toolCalls;
        }
      }
      // else: toolResult / model_change / compaction / label — transparent.
      cursor = next.entry.id;
    }
    rounds.set(userEntryId, {
      finalAssistantId: lastAssistantId,
      stats: { thinking, toolCalls },
    });
  }
  return rounds;
}

function buildCardFromEntry(
  entry: SessionEntry,
  role: CardRole,
  parentCardId: string | null,
  roundStats: { thinking: number; toolCalls: number } | null,
): ConversationCard {
  if (role === "compaction") {
    // Compaction cards never have user/assistant text/image content.
    // Surface the summary as `text` so it round-trips through the
    // generic renderer, and stash the structured fields on a side
    // channel that the ConversationTreePanel can read for the divider
    // header (tokens before, reason, etc.).
    const ce = entry as CompactionEntry;
    return {
      id: entry.id,
      role: "compaction",
      text: ce.summary,
      imageCount: 0,
      roundStats: null,
      parentCardId,
      timestamp: entry.timestamp,
      entryId: entry.id,
      compaction: {
        tokensBefore: ce.tokensBefore,
        firstKeptEntryId: ce.firstKeptEntryId,
        summary: ce.summary,
        usage: ce.usage,
      },
    };
  }
  const msg = messageFromEntry(entry)!;
  const text = extractMessageText(msg);
  const imageCount = countImages(msg);
  return {
    id: entry.id,
    role,
    text,
    imageCount,
    roundStats,
    parentCardId,
    timestamp: entry.timestamp,
    entryId: entry.id,
  };
}

/**
 * Build the flat card list + active path. See the file header for the rules.
 *
 * Algorithm:
 *   1. Index the raw tree (byId + childrenById).
 *   2. Pre-compute {userEntryId → finalAssistantEntryId + roundStats} for
 *      every user entry — gives us the round's closing assistant and edge
 *      label numbers in one pass.
 *   3. DFS-walk the raw tree, emitting cards in preorder. Non-cardable
 *      nodes (toolResult / model_change / compaction / label / etc.) are
 *      skipped at card-emit time but their children are walked with the
 *      surrounding parentCardId. We only emit a final assistant card when
 *      it's the registered "round closer" for the user above it — earlier
 *      assistants in a multi-step round are absorbed (their content is
 *      summarised into the user→assistant edge label).
 *   4. Walk parentId chain from activeLeafId upward; collect card ids
 *      on the path.
 */
export function buildConversationTree(
  roots: SessionTreeNode[],
  activeLeafId: string | null,
): ConversationTree {
  if (roots.length === 0) {
    return { cards: [], activePathIds: new Set() };
  }
  const index = indexRawTree(roots);
  const rounds = precomputeRounds(index);
  const cards: ConversationCard[] = [];

  // When walking the raw tree, an assistant entry is "cardable" only if it
  // is the registered round closer for the user above it. Map
  // userEntryId → assistantEntryId lets us check: is THIS assistant the one
  // we want to emit, or is it an absorbed intermediate?
  const assistantCardIds = new Set<string>();
  for (const { finalAssistantId } of rounds.values()) {
    if (finalAssistantId) assistantCardIds.add(finalAssistantId);
  }

  const walk = (node: SessionTreeNode, parentCardId: string | null): void => {
    const role = entryRole(node.entry);
    if (role === "compaction") {
      // Compaction sits between rounds as a divider. Emit a card so the
      // tree-panel can show "[compaction] compacted from N tokens" but
      // don't claim any round association — the next round starts
      // from the parent that came before this entry in the tree.
      cards.push(
        buildCardFromEntry(node.entry, "compaction", parentCardId, null),
      );
      const compactionCardId = node.entry.id;
      for (const child of node.children) {
        walk(child, compactionCardId);
      }
      return;
    }
    if (role === "user") {
      const round = rounds.get(node.entry.id)!;
      cards.push(
        buildCardFromEntry(node.entry, "user", parentCardId, round.stats),
      );
      // Walk the round's final assistant (if any), then any branch children.
      if (round.finalAssistantId && index.byId.has(round.finalAssistantId)) {
        const aNode = index.byId.get(round.finalAssistantId)!;
        cards.push(
          buildCardFromEntry(aNode.entry, "assistant", node.entry.id, null),
        );
        for (const aChild of aNode.children) {
          walk(aChild, aNode.entry.id);
        }
      }
      return;
    }
    if (role === "assistant") {
      // Stand-alone assistant with no preceding user (rare — only if the
      // session begins with an assistant entry). Emit as root card.
      if (!assistantCardIds.has(node.entry.id)) {
        cards.push(buildCardFromEntry(node.entry, "assistant", parentCardId, null));
      }
      // Otherwise: this assistant is an absorbed intermediate in some
      // round. We still need to walk its children because the round closer
      // below might still be its descendant. But the walker above handles
      // that via findRoundEndAndStats; here we just recurse with the
      // surrounding parentCardId so any branch user cards hanging off
      // this absorbed assistant still get their correct parent.
      for (const child of node.children) {
        walk(child, parentCardId);
      }
      return;
    }
    // Non-cardable node — transparent, recurse with the surrounding
    // parentCardId so the next cardable entry inherits it.
    for (const child of node.children) {
      walk(child, parentCardId);
    }
  };

  for (const r of roots) walk(r, null);

  // Compute active path: walk parentId chain from activeLeafId upward.
  const activePathIds = new Set<string>();
  if (activeLeafId && index.byId.has(activeLeafId)) {
    let cursor: string | null = activeLeafId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const node = index.byId.get(cursor);
      if (!node) break;
      const role = entryRole(node.entry);
      if (role === "user" || role === "assistant" || role === "compaction") {
        activePathIds.add(cursor);
      }
      cursor = node.entry.parentId;
    }
  }

  return { cards, activePathIds };
}