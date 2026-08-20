import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { SessionManager, buildSessionContext as piBuildSessionContext, getAgentDir, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { SessionEntry, SessionInfo, SessionContext, SessionTreeNode, AgentMessage, SessionSearchResult, SessionSearchResponse, SessionSearchPagedResult, SessionSearchPagedResponse, SessionMessageSearchResult, SessionMessageSearchResponse, CompactionEntry, CompactionPoint } from "../shared/types";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "../shared/normalize";

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

function getSessionsDir(): string {
  return `${getAgentDir()}/sessions`;
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

// ============================================================================
// Session search: full-text search over user + assistant messages
// ============================================================================

function workspaceSlug(cwd: string): string {
  return "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
}

function extractMessageContent(msg: Record<string, unknown>): string {
  const content = msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join(" ");
  }
  return "";
}

function buildSnippet(content: string, lowerQuery: string): string {
  const lowerContent = content.toLowerCase();
  const idx = lowerContent.indexOf(lowerQuery);
  if (idx === -1) return content.slice(0, 120) + "...";

  const qlen = lowerQuery.length;
  const start = Math.max(0, idx - 60);
  const end = Math.min(content.length, idx + qlen + 60);

  let snippet = "";
  if (start > 0) snippet += "...";
  snippet += content.slice(start, idx);
  snippet += "\u0000" + content.slice(idx, idx + qlen) + "\u0000";
  snippet += content.slice(idx + qlen, end);
  if (end < content.length) snippet += "...";

  return snippet;
}

async function searchFile(filePath: string, lowerQuery: string): Promise<SessionSearchResult | null> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });

    let sessionId = "";
    let cwd = "";
    let name: string | undefined;
    let matchCount = 0;
    let snippet = "";
    let foundSnippet = false;
    let firstMatchEntryId: string | undefined;
    let matchLocation: "name" | "content" = "content";

    rl.on("line", (line) => {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;

        if (entry.type === "session") {
          sessionId = (entry.id as string) ?? "";
          cwd = (entry.cwd as string) ?? "";
        }

        // Match session name
        if (entry.type === "session_info" && entry.name) {
          name = entry.name as string;
          if (name.toLowerCase().includes(lowerQuery)) {
            matchCount++;
            if (!foundSnippet) {
              snippet = buildSnippet(name, lowerQuery);
              foundSnippet = true;
              matchLocation = "name";
            }
          }
        }

        // Match user / assistant message content
        if (entry.type === "message") {
          const msg = entry.message as Record<string, unknown> | undefined;
          if (msg && (msg.role === "user" || msg.role === "assistant")) {
            const content = extractMessageContent(msg);
            if (content && content.toLowerCase().includes(lowerQuery)) {
              matchCount++;
              if (!foundSnippet) {
                snippet = buildSnippet(content, lowerQuery);
                foundSnippet = true;
                firstMatchEntryId = entry.id as string | undefined;
                matchLocation = "content";
              }
            }
          }
        }
      } catch {
        // Skip malformed JSON lines
      }
    });

    rl.on("close", () => {
      if (matchCount === 0) {
        resolve(null);
        return;
      }
      const stat = fs.statSync(filePath);
      resolve({
        id: sessionId,
        name,
        cwd,
        modified: stat.mtime.toISOString(),
        matchCount,
        snippet,
        firstMatchEntryId,
        matchLocation,
      });
    });

    rl.on("error", reject);
  });
}

export async function searchSessions(cwd: string, query: string): Promise<SessionSearchResponse> {
  const sessionsDir = getSessionsDir();
  const slug = workspaceSlug(cwd);
  const workspaceDir = path.join(sessionsDir, slug);

  if (!fs.existsSync(workspaceDir)) {
    return { results: [], hasMore: false };
  }

  const files = fs.readdirSync(workspaceDir).filter((f) => f.endsWith(".jsonl"));
  const lowerQuery = query.toLowerCase();

  const results: SessionSearchResult[] = [];
  for (const file of files) {
    const filePath = path.join(workspaceDir, file);
    const result = await searchFile(filePath, lowerQuery);
    if (result) results.push(result);
  }

  // Sort by modified descending (most recently active first)
  results.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

  const MAX_RESULTS = 20;
  const hasMore = results.length > MAX_RESULTS;
  return {
    results: results.slice(0, MAX_RESULTS),
    hasMore,
  };
}

/**
 * Paged session search used by the sidebar's "View more sessions" modal.
 *
 * Scans every JSONL file in the cwd's workspace dir, builds the same
 * matches as `searchSessions`, then applies the `limit`/`cursor` boundary
 * the caller asked for. Returns the full SessionInfo for each match so
 * the modal can dispatch straight to `onSelectSession` without an extra
 * `/api/sessions/[id]/info` round-trip per row.
 *
 * Cost: the same as `searchSessions` (one streamed read per file). The
 * caller is responsible for gating this on user action (the modal is
 * opened on demand, not on every sidebar render).
 */
export async function searchSessionsPaged(
  cwd: string,
  query: string,
  limit: number,
  cursor: string | null,
): Promise<SessionSearchPagedResponse> {
  const sessionsDir = getSessionsDir();
  const slug = workspaceSlug(cwd);
  const workspaceDir = path.join(sessionsDir, slug);

  if (!fs.existsSync(workspaceDir)) {
    return { results: [], nextCursor: null, total: 0 };
  }

  const files = fs.readdirSync(workspaceDir).filter((f) => f.endsWith(".jsonl"));
  const lowerQuery = query.toLowerCase();

  // Pass 1: walk every file once, collect matches the same way the Cmd+K
  // search does. We only need match metadata on this side; SessionInfo
  // fields come from the cached listAllSessions() call below.
  const matchMeta: SessionSearchResult[] = [];
  for (const file of files) {
    const filePath = path.join(workspaceDir, file);
    const result = await searchFile(filePath, lowerQuery);
    if (result) matchMeta.push(result);
  }

  // Most recently active first — same precedence as the sidebar's
  // normal paginated list.
  matchMeta.sort((a, b) => b.modified.localeCompare(a.modified));

  const total = matchMeta.length;

  // Cursor: id of the previous page's last row. Skip past it so the
  // same row never appears twice. If the cursor id is no longer in the
  // result set (deleted between pages), fall back to the start.
  let startIdx = 0;
  if (cursor) {
    const idx = matchMeta.findIndex((r) => r.id === cursor);
    if (idx >= 0) startIdx = idx + 1;
  }

  const page = matchMeta.slice(startIdx, startIdx + limit);
  const hasMore = startIdx + limit < total;
  const nextCursor =
    hasMore && page.length > 0 ? page[page.length - 1].id : null;

  // Pass 2: enrich with full SessionInfo. listAllSessions is cached
  // (5s TTL) so a modal that fires search + paginate in quick succession
  // only re-reads the disk once. Missing files (delete between pass 1 and
  // pass 2) fall back to the match metadata alone.
  const allSessions = await listAllSessions(cwd);
  const byId = new Map(allSessions.map((s) => [s.id, s]));

  const results: SessionSearchPagedResult[] = page.map((m) => {
    const info = byId.get(m.id);
    if (info) {
      return { ...info, matchCount: m.matchCount, snippet: m.snippet, matchLocation: m.matchLocation };
    }
    return {
      path: "",
      id: m.id,
      cwd: m.cwd,
      name: m.name,
      created: m.modified,
      modified: m.modified,
      messageCount: 0,
      firstMessage: "",
      running: false,
      matchCount: m.matchCount,
      snippet: m.snippet,
      matchLocation: m.matchLocation,
    };
  });

  return { results, nextCursor, total };
}

// ============================================================================
// In-session message search: full-text over all messages in a single JSONL file
// ============================================================================

/**
 * Build an adjacency table for session entries.
 * Returns maps: children (parentId → childIds) and a leaf-cache for quick lookup.
 */
function buildAdjacency(entries: Array<{ id: string; parentId: string | null }>): {
  children: Map<string, string[]>;
  findLeaf: (entryId: string) => string;
} {
  const children = new Map<string, string[]>();
  for (const e of entries) {
    if (e.parentId) {
      const list = children.get(e.parentId);
      if (list) list.push(e.id);
      else children.set(e.parentId, [e.id]);
    }
  }

  const leafCache = new Map<string, string>();

  function findLeaf(entryId: string, visited: Set<string> = new Set()): string {
    const cached = leafCache.get(entryId);
    if (cached) return cached;
    if (visited.has(entryId)) return entryId; // cycle guard
    visited.add(entryId);
    const kids = children.get(entryId);
    if (!kids || kids.length === 0) {
      leafCache.set(entryId, entryId);
      return entryId;
    }
    // Follow the last child (chronologically most recent branch)
    const leaf = findLeaf(kids[kids.length - 1], visited);
    leafCache.set(entryId, leaf);
    return leaf;
  }

  return { children, findLeaf };
}

/** Extract searchable text from any message type (user / assistant / toolResult) */
function extractMessageSearchContent(msg: Record<string, unknown>): string {
  const content = msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string; thinking?: string }>)
      .filter((block) => block.type === "text" || block.type === "thinking")
      .map((block) => (block as { text?: string; thinking?: string }).text ?? (block as { thinking?: string }).thinking ?? "")
      .join(" ");
  }
  return "";
}

/** Check if a message role is searchable */
function isSearchableRole(role: unknown): boolean {
  return role === "user" || role === "assistant" || role === "toolResult";
}

export async function searchSessionMessages(
  filePath: string,
  query: string,
): Promise<SessionMessageSearchResponse> {
  const lowerQuery = query.toLowerCase();

  // Pass 1: read all entries and collect ids for adjacency building
  interface RawEntry {
    entry: Record<string, unknown>;
    id: string;
    parentId: string | null;
    type: string;
  }
  const entries: RawEntry[] = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      entries.push({
        entry,
        id: entry.id as string,
        parentId: (entry.parentId as string) ?? null,
        type: entry.type as string,
      });
    } catch {
      // Skip malformed lines
    }
  }

  // Build adjacency table + leaf finder
  const { findLeaf } = buildAdjacency(entries);

  // Pass 2: search matching messages
  const allMatchedEntryIds: string[] = [];
  const results: SessionMessageSearchResult[] = [];

  for (const { entry, id, type } of entries) {
    if (type !== "message") continue;

    const msg = entry.message as Record<string, unknown> | undefined;
    if (!msg) continue;

    const role = msg.role;
    if (!isSearchableRole(role)) continue;

    const content = extractMessageSearchContent(msg);
    if (!content || !content.toLowerCase().includes(lowerQuery)) continue;

    allMatchedEntryIds.push(id);

    const leafId = findLeaf(id);

    results.push({
      entryId: id,
      role: role as string,
      snippet: buildSnippet(content, lowerQuery),
      leafId,
      timestamp: entry.timestamp as string | undefined,
    });
  }

  const MAX_SNIPPETS = 20;
  return {
    results: results.slice(0, MAX_SNIPPETS),
    matchedEntryIds: allMatchedEntryIds,
    totalMatches: allMatchedEntryIds.length,
  };
}



