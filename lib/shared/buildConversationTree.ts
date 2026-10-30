import type { AgentMessage, CompactionEntry, CompactionUsage, SessionEntry, SessionTreeNode } from "./types";
import {
  countAssistantBlocks,
  countImages,
  extractMessageText,
} from "./message-content";

export type CardRole = "user" | "assistant" | "compaction";

export interface CompactionCardMeta {
  tokensBefore: number;
  firstKeptEntryId: string;
  summary: string;
  usage?: CompactionUsage;
}

export interface ConversationCard {
  id: string;
  role: CardRole;
  text: string;
  imageCount: number;
  roundStats: { thinking: number; toolCalls: number } | null;
  parentCardId: string | null;
  timestamp: string;
  entryId: string;
  compaction?: CompactionCardMeta;
}

export interface ConversationTree {
  cards: ConversationCard[];
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
    if (entry.type === "compaction") return "compaction";
    return null;
  }
  if (m.role === "user") return "user";
  if (m.role === "assistant") return "assistant";
  return null;
}

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
      if (role === "user") break;
      if (role === "assistant") {
        lastAssistantId = next.entry.id;
        const aMsg = messageFromEntry(next.entry);
        if (aMsg) {
          const stats = countAssistantBlocks(aMsg);
          thinking += stats.thinking;
          toolCalls += stats.toolCalls;
        }
      }
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

  const assistantCardIds = new Set<string>();
  for (const { finalAssistantId } of rounds.values()) {
    if (finalAssistantId) assistantCardIds.add(finalAssistantId);
  }

  const walk = (node: SessionTreeNode, parentCardId: string | null): void => {
    const role = entryRole(node.entry);
    if (role === "compaction") {
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
      if (!assistantCardIds.has(node.entry.id)) {
        cards.push(buildCardFromEntry(node.entry, "assistant", parentCardId, null));
      }
      for (const child of node.children) {
        walk(child, parentCardId);
      }
      return;
    }
    for (const child of node.children) {
      walk(child, parentCardId);
    }
  };

  for (const r of roots) walk(r, null);

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