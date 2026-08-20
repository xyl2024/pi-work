import { statSync } from "fs";
import {
  SessionManager,
  buildSessionContext as piBuildSessionContext,
  getAgentDir,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentMessage,
  CompactionEntry,
  CompactionPoint,
  SessionContext,
  SessionEntry,
  SessionInfo,
  SessionTreeNode,
} from "@/lib/shared/types";
import type {
  SessionEntry as PiSessionEntry,
  SessionInfo as PiSessionInfo,
} from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "@/lib/shared/normalize";

export { getAgentDir };

// ============================================================================
// Session-tree cleanup helpers
//
// session_info entries are session metadata (name), not conversation branch
// nodes. They are appended by pi when a session is (auto-)renamed, hung off
// whatever the leaf was at that moment — which turns them into a side-branch
// that misroutes buildConversationTree's per-round children[0] walk (the
// round's final assistant gets locked early and every intermediate message
// renders as a standalone card). Both the disk-loaded tree
// (/api/sessions/[id]) and the live tree pushed over SSE must apply the same
// cleanup so they render identically.
// ============================================================================

/**
 * Strip session_info nodes out of a branch tree (children promoted into the
 * vacated slot). Re-links each promoted child's parentId to the session_info's
 * own parentId so the active-path walk in lib/buildConversationTree — which
 * follows entry.parentId upward — can keep climbing past the strip point.
 */
export function stripSessionInfoNodes<T extends { entry: { type?: string; parentId?: string | null }; children: T[] }>(nodes: T[]): T[] {
  const out: T[] = [];
  for (const n of nodes) {
    if (n.entry.type === "session_info") {
      const promotedParentId = n.entry.parentId ?? null;
      for (const child of stripSessionInfoNodes(n.children)) {
        out.push({
          ...child,
          entry: { ...child.entry, parentId: promotedParentId },
        });
      }
    } else {
      out.push({ ...n, children: stripSessionInfoNodes(n.children) });
    }
  }
  return out;
}

/**
 * When a session_info entry is the last one in the file, reloading makes it
 * the leaf; subsequent messages would then hang off the metadata entry. Walk
 * back to the nearest real entry so the returned leaf stays a real message.
 */
export function fallbackSessionLeafId(
  sm: { getEntry(id: string): unknown },
  leafId: string | null,
): string | null {
  let cur = leafId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const entry = sm.getEntry(cur);
    if (!entry || (entry as { type?: string }).type !== "session_info") break;
    cur = (entry as { parentId?: string | null }).parentId ?? null;
  }
  return cur;
}

export async function listAllSessions(cwd?: string): Promise<SessionInfo[]> {
  const all = await loadAllSessionsCached();
  if (!cwd) return all;
  return all.filter((s) => s.cwd === cwd);
}

// ============================================================================
// In-memory list cache (TTL 5s)
// `SessionManager.listAll` scans every JSONL header across the disk, which is
// expensive on machines with thousands of session files. Multiple pagination
// requests landing within the same TTL window share one scan.
//
// Mutations (rename / delete / new session) call `invalidateSessionListCache`
// explicitly so user-initiated changes are immediately visible.
// ============================================================================

const LIST_CACHE_TTL_MS = 5_000;

declare global {
  var __piSessionListCache: { list: SessionInfo[]; loadedAt: number } | undefined;
  var __piSessionListInflight: Promise<SessionInfo[]> | undefined;
}

function toSessionInfo(piSessions: PiSessionInfo[]): SessionInfo[] {
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(s.path, s.id);

  const cache = getPathCache();
  return piSessions.map((s) => {
    // Populate path cache so resolveSessionPath works without a full scan
    cache.set(s.id, s.path);
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath ? pathToId.get(s.parentSessionPath) : undefined,
      // Read layer has no RPC context; the /api/sessions route enriches from the wrapper registry.
      running: false,
    };
  });
}

/** Internal: return the cached full-list, refreshing if TTL elapsed. */
async function loadAllSessionsCached(): Promise<SessionInfo[]> {
  const now = Date.now();
  const cached = globalThis.__piSessionListCache;
  if (cached && now - cached.loadedAt < LIST_CACHE_TTL_MS) {
    return cached.list;
  }

  // Coalesce concurrent cold loads
  if (globalThis.__piSessionListInflight) {
    return globalThis.__piSessionListInflight;
  }

  const loadPromise = (async () => {
    const piSessions = await SessionManager.listAll();
    return toSessionInfo(piSessions);
  })();

  globalThis.__piSessionListInflight = loadPromise;
  try {
    const list = await loadPromise;
    globalThis.__piSessionListCache = { list, loadedAt: Date.now() };
    return list;
  } finally {
    globalThis.__piSessionListInflight = undefined;
  }
}

/**
 * Drop the cached full-list. Call after any mutation that changes the set or
 * metadata of sessions (rename / delete / new session creation).
 */
export function invalidateSessionListCache(): void {
  globalThis.__piSessionListCache = undefined;
}

// ============================================================================
// Session path cache: sessionId → absolute file path
// Stored in globalThis for hot-reload safety
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  getPathCache().set(sessionId, filePath);
}

export function invalidateSessionPathCache(sessionId: string): void {
  getPathCache().delete(sessionId);
}

export function buildTree(entries: SessionEntry[]): SessionTreeNode[] {
  const nodeMap = new Map<string, SessionTreeNode>();
  const labelsById = new Map<string, string>();

  for (const entry of entries) {
    if (entry.type === "label") {
      const l = entry as { type: "label"; targetId: string; label?: string };
      if (l.label) labelsById.set(l.targetId, l.label);
      else labelsById.delete(l.targetId);
    }
  }

  const roots: SessionTreeNode[] = [];
  for (const entry of entries) {
    nodeMap.set(entry.id, { entry, children: [], label: labelsById.get(entry.id) });
  }
  for (const entry of entries) {
    const node = nodeMap.get(entry.id)!;
    if (!entry.parentId) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(entry.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }

  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    node.children.sort((a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime());
    stack.push(...node.children);
  }
  return roots;
}

/**
 * Build the full active-branch history for the browser. This deliberately does
 * not use pi's compaction-trimmed message list: that list is the runtime context
 * sent to the model, while the UI must keep showing messages already summarized
 * by a compaction entry.
 */
export function buildSessionContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  // Build entryIds + entryTimestamps: parallel arrays to messages[], mapping
  // each message back to its entry id and the entry-level persistence timestamp
  // (ms). entryIds is needed for navigate_tree calls from the UI; the
  // timestamps feed the per-turn duration display (turn end = the entry
  // timestamp of the last assistant message, i.e. when its stream finished).
  let targetLeaf: SessionEntry | undefined;
  if (leafId === null) {
    return { messages: [], entryIds: [], entryTimestamps: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model, compactionPoints: [] };
  }
  if (leafId) targetLeaf = byId.get(leafId);
  if (!targetLeaf) targetLeaf = entries[entries.length - 1];
  if (!targetLeaf) {
    return { messages: [], entryIds: [], entryTimestamps: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model, compactionPoints: [] };
  }

  // Walk path from target leaf to root
  const path: SessionEntry[] = [];
  let cur: SessionEntry | undefined = targetLeaf;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  // Project every displayable entry on the full path and build all parallel
  // arrays in the same loop. Compaction entries are rendered separately as
  // dividers, so their synthetic compactionSummary messages stay out of the
  // normal message list.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  const entryTimestamps: (number | undefined)[] = [];
  for (const entry of path) {
    if (entry.type === "compaction") continue;
    const projectedMessages = sessionEntryToContextMessages(
      entry as unknown as PiSessionEntry,
    ) as unknown as AgentMessage[];
    for (const message of projectedMessages) {
      messages.push(normalizeToolCalls(message));
      entryIds.push(entry.id);
      const ts = typeof entry.timestamp === "string" ? new Date(entry.timestamp).getTime() : undefined;
      entryTimestamps.push(Number.isFinite(ts) ? ts : undefined);
    }
  }

  // Compaction points: every `compaction` entry on the visible path. The
  // divider belongs before the first displayed message after the compaction;
  // `beforeMessageEntryId` is set to that id when one exists. When the
  // compaction is at the tail of the path (e.g. just compacted, no new
  // messages yet), we still surface the point so the chat stream renders
  // a trailing divider instead of waiting for the user to send another
  // message — otherwise the chat looks unchanged until the next prompt.
  const visibleEntryIds = new Set(entryIds);
  const compactionPoints: CompactionPoint[] = [];
  for (const e of path) {
    if (e.type !== "compaction") continue;
    const ce = e as CompactionEntry;
    // First visible message after this compaction entry on the path.
    let afterId: string | undefined;
    let afterSelf = false;
    for (const p of path) {
      if (p.id === ce.id) {
        afterSelf = true;
        continue;
      }
      if (!afterSelf) continue;
      if (visibleEntryIds.has(p.id)) {
        afterId = p.id;
        break;
      }
    }
    compactionPoints.push({
      entryId: ce.id,
      tokensBefore: ce.tokensBefore,
      summary: ce.summary,
      beforeMessageEntryId: afterId,
      timestamp: ce.timestamp,
    });
  }

  return {
    messages,
    entryIds,
    entryTimestamps,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
    compactionPoints,
  };
}

/** Read the disk-backed session payload used by GET /api/sessions/[id]. */
export async function readSessionDetails(sessionId: string) {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;

  const sm = SessionManager.open(filePath);
  const entries = sm.getEntries() as never;
  const tree = stripSessionInfoNodes(sm.getTree());
  const leafId = fallbackSessionLeafId(sm, sm.getLeafId());
  const context = buildSessionContext(entries, leafId);

  const header = sm.getHeader();
  let modified = header?.timestamp ?? new Date().toISOString();
  try {
    modified = statSync(filePath).mtime.toISOString();
  } catch {
    // Use the header timestamp when stat fails.
  }
  const allSessions = await listAllSessions();
  const parentSessionId = allSessions.find((s) => s.id === sessionId)?.parentSessionId;
  const info = header ? {
    path: filePath,
    id: header.id,
    cwd: header.cwd ?? "",
    name: sm.getSessionName(),
    created: header.timestamp,
    modified,
    messageCount: context.messages.length,
    firstMessage: context.messages.find((m) => m.role === "user")
      ? (() => {
          const msg = context.messages.find((m) => m.role === "user")!;
          const content = (msg as { content: unknown }).content;
          return typeof content === "string"
            ? content
            : (Array.isArray(content)
                ? (content.find((block: { type: string }) => block.type === "text") as { text: string } | undefined)?.text ?? ""
                : "") || "(no messages)";
        })()
      : "(no messages)",
    parentSessionId,
  } : null;

  return {
    sessionId,
    filePath,
    info,
    tree,
    leafId,
    context,
  };
}
