import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import type {
  SessionMessageSearchResponse,
  SessionMessageSearchResult,
  SessionSearchPagedResponse,
  SessionSearchPagedResult,
  SessionSearchResponse,
  SessionSearchResult,
} from "@/lib/shared/types";
import { getAgentDir, listAllSessions } from "./reader";

function getSessionsDir(): string {
  return `${getAgentDir()}/sessions`;
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
