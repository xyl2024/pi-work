import { closeSync, openSync, readSync, statSync } from "fs";
import { StringDecoder } from "string_decoder";
import {
  SessionManager,
  buildSessionContext as piBuildSessionContext,
  getAgentDir,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentMessage,
  AssistantMessage,
  CompactionEntry,
  CompactionPoint,
  SessionContext,
  SessionEntry,
  SessionInfo,
} from "@/lib/shared/types";
import type {
  SessionEntry as PiSessionEntry,
  SessionInfo as PiSessionInfo,
} from "@earendil-works/pi-coding-agent";
import { listSessionNames } from "@/lib/server/session-names";
import { isMessageOriginEntryData, MESSAGE_ORIGIN_ENTRY_TYPE } from "@/lib/shared/message-origin";
import { normalizeToolCalls } from "@/lib/shared/normalize";
import { cleanFirstMessage } from "@/lib/shared/session-title";
import {
  SUBAGENT_ACTIVITY_DEFAULT_LIMIT,
  SUBAGENT_ACTIVITY_MAX_LIMIT,
} from "@/lib/shared/subagent";

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
      firstMessage: cleanFirstMessage(s.firstMessage),
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
 *
 * Clears both caches (full-read and header-only) so user-initiated changes
 * are immediately visible to either listing path.
 */
export function invalidateSessionListCache(): void {
  globalThis.__piSessionListCache = undefined;
  globalThis.__piSessionListHeaderCache = undefined;
}

// ============================================================================
// Header-only session listing (5s TTL, separate cache slot)
//
// `SessionManager.listAll()` reads every .jsonl file to EOF to compute
// `messageCount` / `name` / `firstMessage` / `lastActivityTime`. On a host
// with 1000+ session files (200+ MB total) that scan is consistently
// ~1.8-2.1s, regardless of how few rows the caller actually wants. The
// sidebar's /api/sessions first page (limit=3) only needs header data,
// which is normally in the first few entries of each file.
//
// Trade-offs vs. the full scan:
//   * `modified`     → file `mtime` (pi rewrites the file on every flush,
//                      so `mtime` is within microseconds of `lastActivityTime`)
//   * `name`         → first `session_info.name` we encounter; renames past
//                      the scan ceiling are dropped (sidebar renders
//                      `name || firstMessage.slice(0,50) || id`, so the
//                      fallback handles the missing-rename case, and the
//                      sidecar name index recovers most of them)
//   * `firstMessage` → first user message we encounter (chunked scan, see
//                      HEADER_SCAN_CHUNK_BYTES: the system-prompt entry alone
//                      can be bigger than one chunk)
//   * `messageCount` → 0 (callers that need a real count can defer to
//                      /api/sessions/[id], which loads the full SessionContext)
//
// Caller contract is unchanged: same SessionInfo[] shape, same return order
// (newest-first by mtime).
// ============================================================================

/**
 * Bytes per `read(2)`. A single fixed window is not enough: pi writes the
 * session's system prompt as a `message` entry (role `system`, content `""`,
 * prompt in `sections`) that is routinely 30KB+, so the first *user* message
 * can sit well past 16KB. With a fixed window such a session reported no
 * `firstMessage` and the sidebar fell back to pi's "(no messages)" placeholder
 * as if it were the title. The scan now keeps pulling chunks until it knows
 * header + name + first message, with a ceiling so one pathological file can
 * never make the listing read forever.
 */
const HEADER_SCAN_CHUNK_BYTES = 16 * 1024;
const HEADER_SCAN_MAX_BYTES = 1024 * 1024;

interface HeaderScanResult {
  id: string;
  cwd: string;
  created: string;
  parentSessionPath?: string;
  name?: string;
  firstMessage?: string;
}

/** Pull a text block out of a message content (string | text-block array | other). */
function extractMessageText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        return (block as { text: string }).text;
      }
    }
  }
  return undefined;
}

/**
 * Bounded-scan reader: read the file in fixed chunks, split on newlines,
 * JSON.parse each line, capture the fields the sidebar needs. Stops as soon as
 * header + name + first user message are populated (or at the byte ceiling).
 *
 * A line is only parsed once its terminating newline arrived, so the huge
 * system-prompt entry — far bigger than one chunk — is carried across chunks
 * instead of being cut in half and dropped.
 */
function readHeaderOnly(filePath: string): HeaderScanResult | null {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const decoder = new StringDecoder("utf8");
    const chunk = Buffer.allocUnsafe(HEADER_SCAN_CHUNK_BYTES);

    let id: string | undefined;
    let cwd: string | undefined;
    let created: string | undefined;
    let parentSessionPath: string | undefined;
    let name: string | undefined;
    let firstMessage: string | undefined;
    let headerSeen = false;
    // Bytes of the last line that did not fit in the previous chunk (a single
    // entry can be far larger than one chunk — the system prompt one is).
    let pending = "";
    let offset = 0;
    let eof = false;

    while (!eof && offset < HEADER_SCAN_MAX_BYTES) {
      let bytesRead = 0;
      try {
        bytesRead = readSync(fd, chunk, 0, chunk.length, offset);
      } catch {
        break;
      }
      if (bytesRead === 0) eof = true;
      offset += bytesRead;

      // StringDecoder holds back a split multi-byte character, so lines are
      // never cut mid-codepoint. On EOF every remaining line is complete; mid
      // file the last element is the unterminated tail and is carried over.
      const lines = (pending + decoder.write(chunk.subarray(0, bytesRead))).split("\n");
      pending = eof ? "" : lines.pop() ?? "";

      for (const line of lines) {
        if (!line) continue;
        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (!entry || typeof entry !== "object") continue;

        // First session entry holds the header.
        const entryType = (entry as { type?: unknown }).type;
        if (!headerSeen && entryType === "session" && typeof (entry as { id?: unknown }).id === "string") {
          id = (entry as { id: string }).id;
          const cwdVal = (entry as { cwd?: unknown }).cwd;
          cwd = typeof cwdVal === "string" ? cwdVal : "";
          const tsVal = (entry as { timestamp?: unknown }).timestamp;
          created = typeof tsVal === "string" ? tsVal : undefined;
          const parentVal = (entry as { parentSession?: unknown }).parentSession;
          parentSessionPath = typeof parentVal === "string" ? parentVal : undefined;
          headerSeen = true;
          continue;
        }
        if (!headerSeen) continue; // ignore anything before the header

        if (entryType === "session_info" && typeof (entry as { name?: unknown }).name === "string") {
          const trimmed = ((entry as { name: string }).name).trim();
          if (trimmed) name = trimmed;
        } else if (entryType === "message" && firstMessage === undefined) {
          const msg = (entry as { message?: { role?: unknown; content?: unknown } }).message;
          if (msg && (msg.role === "user" || msg.role === "assistant")) {
            const text_ = extractMessageText(msg.content);
            if (text_) firstMessage = text_;
          }
        }
      }

      // Stop as soon as both are known, or once the first message is known and
      // the chunk we just read already covers the name window the old fixed
      // 16KB scan provided — a rename appended deeper in the file is the
      // sidecar name index's job, not this window's. Cost per file therefore
      // stays at the usual single chunk for ordinary sessions; only a session
      // whose first user message sits deeper (big system-prompt entry) pays
      // for the extra chunks it actually needs.
      if (name !== undefined && firstMessage !== undefined) break;
      if (firstMessage !== undefined && offset >= HEADER_SCAN_CHUNK_BYTES) break;
    }

    if (!id || !created) return null;
    const result: HeaderScanResult = { id, cwd: cwd ?? "", created };
    if (parentSessionPath !== undefined) result.parentSessionPath = parentSessionPath;
    if (name !== undefined) result.name = name;
    if (firstMessage !== undefined) result.firstMessage = firstMessage;
    return result;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** stat().mtime with a null fallback for races (concurrent delete, etc.). */
function safeStatMtime(filePath: string): Date | null {
  try {
    return statSync(filePath).mtime;
  } catch {
    return null;
  }
}

declare global {
  var __piSessionListHeaderCache: { list: SessionInfo[]; loadedAt: number } | undefined;
  var __piSessionListHeaderInflight: Promise<SessionInfo[]> | undefined;
}

async function listAllSessionsHeaderOnlyUnfiltered(): Promise<SessionInfo[]> {
  const now = Date.now();
  const cached = globalThis.__piSessionListHeaderCache;
  if (cached && now - cached.loadedAt < LIST_CACHE_TTL_MS) {
    return cached.list;
  }
  if (globalThis.__piSessionListHeaderInflight) {
    return globalThis.__piSessionListHeaderInflight;
  }

  const sessionsDir = `${getAgentDir()}/sessions`;
  const loadPromise = (async (): Promise<SessionInfo[]> => {
    const { readdir } = await import("fs/promises");
    const { join } = await import("path");
    let subdirs: string[] = [];
    try {
      const entries = await readdir(sessionsDir, { withFileTypes: true });
      subdirs = entries
        .filter((e) => e.isDirectory() || e.isSymbolicLink())
        .map((e) => join(sessionsDir, e.name));
    } catch {
      return [];
    }
    const allFiles: string[] = [];
    for (const dir of subdirs) {
      try {
        const files = await readdir(dir);
        for (const f of files) {
          if (f.endsWith(".jsonl")) allFiles.push(join(dir, f));
        }
      } catch {
        // unreadable subdir — skip
      }
    }

    const pathToId = new Map<string, string>();
    const seen = new Set<string>();
    const out: SessionInfo[] = [];
    for (const filePath of allFiles) {
      const mtime = safeStatMtime(filePath);
      if (!mtime) continue;
      const header = readHeaderOnly(filePath);
      if (!header) continue;
      if (seen.has(header.id)) continue; // duplicate id — keep first
      seen.add(header.id);
      pathToId.set(filePath, header.id);
      const info: SessionInfo = {
        path: filePath,
        id: header.id,
        cwd: header.cwd,
        name: header.name,
        created: header.created,
        modified: mtime.toISOString(),
        messageCount: 0, // callers needing real counts hit /api/sessions/[id]
        firstMessage: cleanFirstMessage(header.firstMessage),
        parentSessionId: undefined,
        running: false, // enriched by the /api/sessions route from the wrapper registry
      };
      if (header.parentSessionPath) {
        info.parentSessionId = pathToId.get(header.parentSessionPath);
      }
      out.push(info);
    }

    // Newest-first by mtime to match SessionManager.listAll's contract.
    out.sort((a, b) => b.modified.localeCompare(a.modified));

    // Merge the sidecar name index in one pass — the chunked scan
    // stops early (roughly the first 16KB for ordinary sessions) and sees
    // only the FIRST session_info there; users who rename a
    // session after a long conversation would otherwise see the wrong
    // (or no) name in the sidebar. The sidecar is the canonical
    // authoritative name source; see lib/server/session-names.ts.
    if (out.length > 0) {
      const names = await listSessionNames();
      if (names.size > 0) {
        for (const s of out) {
          const fromSidecar = names.get(s.id);
          if (fromSidecar) s.name = fromSidecar.name;
        }
      }
    }

    // Mirror the path cache populated by the full-scan reader so that
    // resolveSessionPath() hit-shops in subsequent calls.
    const pathCache = globalThis.__piSessionPathCache;
    if (pathCache) {
      for (const s of out) pathCache.set(s.id, s.path);
    }
    return out;
  })();

  globalThis.__piSessionListHeaderInflight = loadPromise;
  try {
    const list = await loadPromise;
    globalThis.__piSessionListHeaderCache = { list, loadedAt: Date.now() };
    return list;
  } finally {
    globalThis.__piSessionListHeaderInflight = undefined;
  }
}

/**
 * Header-only, list-ALL with optional cwd filter. Same call shape as
 * listAllSessions; same SessionInfo[] contract; same 5s TTL cache slot.
 * Skips full-file reads; ~10-20x faster on hosts with many large sessions.
 *
 * Differences from `listAllSessions` (acceptable for sidebar list views):
 *   - `modified`    is `mtime` (within milliseconds of activity time).
 *   - `name`        is the first session_info inside the scan window.
 *   - `firstMessage` is the first user/assistant message inside the window.
 *   - `messageCount` is always 0.
 */
export async function listAllSessionsHeaderOnly(cwd?: string): Promise<SessionInfo[]> {
  const all = await listAllSessionsHeaderOnlyUnfiltered();
  if (!cwd) return all;
  return all.filter((s) => s.cwd === cwd);
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

  // Cache miss: the header-only listing fills the same id → path cache as the
  // full scan, but stops after the first chunk (16KB) for ordinary sessions
  // instead of reading every file to EOF (~1s vs ~5s on a host with thousands
  // of sessions). Only when
  // the bounded reader can't see the id (malformed/short header, delete race)
  // do we pay for the full `SessionManager.listAll()` scan.
  await listAllSessionsHeaderOnly();
  const fromHeaderScan = getPathCache().get(sessionId);
  if (fromHeaderScan) return fromHeaderScan;

  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  getPathCache().set(sessionId, filePath);
}

export function invalidateSessionPathCache(sessionId: string): void {
  getPathCache().delete(sessionId);
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

  // 消息来源（ADR-0023）：非网页来源的用户消息身后跟着一条
  // `pi_work_message_origin` custom entry，挂在它描述的 user entry 之后。
  // 归属规则：树序上最近的前一条 user message —— 沿 path 正序扫，遇到 entry
  // 就记到当前的 user entry 上。origin 只在这里合并进返回给 UI 的消息对象，
  // 绝不写回 JSONL 消息体；非法数据按缺省处理（不带 origin）。entry 随消息
  // 树走：不在 path 上的 entry 自然脱落（分支）；被压缩掻掉的 entry 也随之
  // 消失——最后一个 compaction 的 firstKeptEntryId 之前的区域是已被摘要
  // 吞掉的部分，其间的 user message 与 origin entry 不再参与归属（保持与
  // pi buildContextEntries 的压缩语义一致），后续消息也不会错挂到它们身上。
  const originByUserEntryId = new Map<string, unknown>();
  // 压缩切点：最后一个 compaction entry 在 path 上的 firstKeptEntryId 下标；
  // 该下标之前的 entry 都算被压缩掉。无压缩时为 0（不切）。
  let compactedBefore = 0;
  for (let i = path.length - 1; i >= 0; i--) {
    const entry = path[i] as { type?: string; firstKeptEntryId?: string };
    if (entry.type === "compaction") {
      const keptIdx = path.findIndex((e) => e.id === entry.firstKeptEntryId);
      compactedBefore = keptIdx !== -1 && keptIdx < i ? keptIdx : i;
      break;
    }
  }
  let lastUserEntryId: string | undefined;
  path.forEach((entry, idx) => {
    const compacted = idx < compactedBefore;
    if (entry.type === "message" && (entry as { message?: { role?: string } }).message?.role === "user") {
      if (!compacted) lastUserEntryId = entry.id;
      return;
    }
    if (
      !compacted &&
      entry.type === "custom" &&
      (entry as unknown as { customType?: string }).customType === MESSAGE_ORIGIN_ENTRY_TYPE &&
      lastUserEntryId
    ) {
      const data = (entry as unknown as { data?: unknown }).data;
      if (isMessageOriginEntryData(data)) originByUserEntryId.set(lastUserEntryId, data.origin);
    }
  });

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
      const withOrigin = originByUserEntryId.has(entry.id) && message.role === "user"
        ? { ...message, origin: originByUserEntryId.get(entry.id) } as AgentMessage
        : message;
      messages.push(normalizeToolCalls(withOrigin));
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

/**
 * Parent session id for one session file, without scanning every session.
 *
 * The session header stores `parentSession` as a *path*; the id we hand the UI
 * lives in that parent file's own header, so a single first-chunk read is
 * enough — same mapping the full listing does (`parentSessionPath` → id).
 * Missing/unreadable parents resolve to `undefined`, matching what the full
 * scan produced when the parent wasn't in its path index.
 */
export function resolveParentSessionId(parentSessionPath: string | undefined): string | undefined {
  if (!parentSessionPath) return undefined;
  return readHeaderOnly(parentSessionPath)?.id;
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
  const parentSessionId = resolveParentSessionId(header?.parentSession);
  const info = header ? {
    path: filePath,
    id: header.id,
    cwd: header.cwd ?? "",
    name: sm.getSessionName(),
    created: header.timestamp,
    modified,
    messageCount: context.messages.length,
    // Same placeholder rule as the two listing paths: no user text → "", so the
    // UI falls back to its unnamed-title rule instead of showing "(no messages)".
    firstMessage: cleanFirstMessage(
      extractMessageText(
        (context.messages.find((m) => m.role === "user") as { content?: unknown } | undefined)?.content,
      ),
    ),
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

// ============================================================================
// Subagent session stats
//
// Lightweight per-child aggregate (assistant messages, read-tool file count,
// model id) used by /api/sessions/[id]/subagents. Polling re-runs this for
// every child of a parent session, so results are cached per JSONL mtime —
// an unchanged file is never re-parsed.
// ============================================================================

export interface SubagentSessionStats {
  assistantCount: number;
  readCount: number;
  model: string | null;
}

declare global {
  var __piSubagentStatsCache: Map<string, { mtimeMs: number; stats: SubagentSessionStats }> | undefined;
}

function getSubagentStatsCache(): Map<string, { mtimeMs: number; stats: SubagentSessionStats }> {
  globalThis.__piSubagentStatsCache ??= new Map();
  return globalThis.__piSubagentStatsCache;
}

/** Aggregate assistant/read/model stats for one child session. */
export async function readSubagentSessionStats(sessionId: string): Promise<SubagentSessionStats | null> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    return null;
  }

  const cache = getSubagentStatsCache();
  const cached = cache.get(sessionId);
  if (cached && cached.mtimeMs === mtimeMs) return cached.stats;

  let stats: SubagentSessionStats = { assistantCount: 0, readCount: 0, model: null };
  try {
    const sm = SessionManager.open(filePath);
    const entries = sm.getEntries() as never;
    const leafId = fallbackSessionLeafId(sm, sm.getLeafId());
    const context = buildSessionContext(entries, leafId);

    let assistantCount = 0;
    const readPaths = new Set<string>();
    let readCalls = 0;
    let model: string | null = null;
    for (const message of context.messages) {
      if (message.role !== "assistant") continue;
      assistantCount += 1;
      const assistant = message as AssistantMessage;
      if (assistant.model) model = assistant.model;
      for (const block of (normalizeToolCalls(message) as AssistantMessage).content) {
        if (block.type !== "toolCall" || block.toolName !== "read") continue;
        const path = block.input?.path;
        if (typeof path === "string" && path) {
          readPaths.add(path);
        } else {
          readCalls += 1;
        }
      }
    }
    stats = { assistantCount, readCount: readPaths.size + readCalls, model };
  } catch {
    // Unreadable / mid-write JSONL: fall through with zeroed stats.
  }

  cache.set(sessionId, { mtimeMs, stats });
  return stats;
}

// ============================================================================
// Subagent live info (stats + recent tool-call activity)
//
// Feeds the activity window of a subagent task detail (`subagent` tool
// `get` / session lookups). Same mtime-cache pattern as
// readSubagentSessionStats — an unchanged JSONL is never re-parsed.
// ============================================================================

/** One recent tool call in the child session, for the activity window. */
export type { SubagentActivityItem } from "@/lib/shared/types";
import type { SubagentActivityItem } from "@/lib/shared/types";

/** Raw aggregate computed from the child session JSONL (before callers slice
 *  their own window off it). */
export interface SubagentLiveSnapshot {
  assistantCount: number;
  readCount: number;
  model: string | null;
  /** Recent tool calls in chronological order (oldest first). */
  activities: SubagentActivityItem[];
  /** Total number of tool calls in the child session, before the window. */
  activityCount: number;
}

interface SubagentLiveCacheEntry {
  mtimeMs: number;
  info: SubagentLiveSnapshot;
}

declare global {
  var __piSubagentLiveCache: Map<string, SubagentLiveCacheEntry> | undefined;
}

function getSubagentLiveCache(): Map<string, SubagentLiveCacheEntry> {
  globalThis.__piSubagentLiveCache ??= new Map();
  return globalThis.__piSubagentLiveCache;
}

const ACTIVITY_SUMMARY_KEYS = [
  "path", "pattern", "query", "symbol", "command", "action", "url", "name",
  "file", "description", "mode", "filter", "subject", "taskId",
] as const;

const ACTIVITY_SUMMARY_MAX = 120;

/**
 * The cache is keyed by session mtime, so it must hold the same window whatever
 * a caller asks for; callers slice their own limit off the tail.
 */
const ACTIVITY_CACHE_LIMIT = SUBAGENT_ACTIVITY_MAX_LIMIT;

/** Short single-line preview of a tool call's input, mirroring the UI's tool preview. */
export function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  for (const key of ACTIVITY_SUMMARY_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value) {
      const oneLine = value.replace(/\s+/g, " ").trim();
      return oneLine.length > ACTIVITY_SUMMARY_MAX ? `${oneLine.slice(0, ACTIVITY_SUMMARY_MAX)}…` : oneLine;
    }
  }
  const firstKey = Object.keys(record)[0];
  if (firstKey === undefined) return "";
  const oneLine = String(record[firstKey]).replace(/\s+/g, " ").trim();
  return oneLine.length > ACTIVITY_SUMMARY_MAX ? `${oneLine.slice(0, ACTIVITY_SUMMARY_MAX)}…` : oneLine;
}

/** Aggregate stats + recent tool-call activity for one child session. */
export async function readSubagentLiveInfo(
  sessionId: string,
  activityLimit = SUBAGENT_ACTIVITY_DEFAULT_LIMIT,
): Promise<SubagentLiveSnapshot | null> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    return null;
  }

  const cache = getSubagentLiveCache();
  const cached = cache.get(sessionId);
  // The cache holds the widest window; each caller gets its own slice, even on
  // a cache hit (a hit must not leak the previous caller's limit).
  const limited = (info: SubagentLiveSnapshot): SubagentLiveSnapshot => ({
    ...info,
    activities: activityLimit > 0 ? info.activities.slice(-activityLimit) : [],
  });
  if (cached && cached.mtimeMs === mtimeMs) return limited(cached.info);

  const empty: SubagentLiveSnapshot = { assistantCount: 0, readCount: 0, model: null, activities: [], activityCount: 0 };
  let info: SubagentLiveSnapshot = empty;
  try {
    const sm = SessionManager.open(filePath);
    const entries = sm.getEntries() as never;
    const leafId = fallbackSessionLeafId(sm, sm.getLeafId());
    const context = buildSessionContext(entries, leafId);

    let assistantCount = 0;
    const readPaths = new Set<string>();
    let readCalls = 0;
    let model: string | null = null;
    const activities: SubagentActivityItem[] = [];
    for (let i = 0; i < context.messages.length; i += 1) {
      const message = context.messages[i];
      if (message.role !== "assistant") continue;
      assistantCount += 1;
      const assistant = message as AssistantMessage;
      if (assistant.model) model = assistant.model;
      const timestamp = context.entryTimestamps?.[i] ?? null;
      for (const block of (normalizeToolCalls(message) as AssistantMessage).content) {
        if (block.type !== "toolCall") continue;
        if (block.toolName === "read") {
          const path = block.input?.path;
          if (typeof path === "string" && path) readPaths.add(path);
          else readCalls += 1;
        }
        activities.push({
          toolName: block.toolName,
          summary: summarizeToolInput(block.input),
          timestamp: typeof timestamp === "number" ? timestamp : null,
        });
      }
    }
    info = {
      assistantCount,
      readCount: readPaths.size + readCalls,
      model,
      activities: activities.slice(-ACTIVITY_CACHE_LIMIT),
      activityCount: activities.length,
    };
  } catch {
    // Unreadable / mid-write JSONL: fall through with the empty snapshot.
  }

  cache.set(sessionId, { mtimeMs, info });
  return limited(info);
}
