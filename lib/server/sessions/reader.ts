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
  ChangeMarker,
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
      running: false,
    };
  });
}

async function loadAllSessionsCached(): Promise<SessionInfo[]> {
  const now = Date.now();
  const cached = globalThis.__piSessionListCache;
  if (cached && now - cached.loadedAt < LIST_CACHE_TTL_MS) {
    return cached.list;
  }

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

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListCache = undefined;
  globalThis.__piSessionListHeaderCache = undefined;
}

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
        if (!headerSeen) continue;

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
      if (seen.has(header.id)) continue;
      seen.add(header.id);
      pathToId.set(filePath, header.id);
      const info: SessionInfo = {
        path: filePath,
        id: header.id,
        cwd: header.cwd,
        name: header.name,
        created: header.created,
        modified: mtime.toISOString(),
        messageCount: 0,
        firstMessage: cleanFirstMessage(header.firstMessage),
        parentSessionId: undefined,
        running: false,
      };
      if (header.parentSessionPath) {
        info.parentSessionId = pathToId.get(header.parentSessionPath);
      }
      out.push(info);
    }

    out.sort((a, b) => b.modified.localeCompare(a.modified));

    if (out.length > 0) {
      const names = await listSessionNames();
      if (names.size > 0) {
        for (const s of out) {
          const fromSidecar = names.get(s.id);
          if (fromSidecar) s.name = fromSidecar.name;
        }
      }
    }

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

export async function listAllSessionsHeaderOnly(cwd?: string): Promise<SessionInfo[]> {
  const all = await listAllSessionsHeaderOnlyUnfiltered();
  if (!cwd) return all;
  return all.filter((s) => s.cwd === cwd);
}

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

export function buildSessionContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  let targetLeaf: SessionEntry | undefined;
  if (leafId === null) {
    return { messages: [], entryIds: [], entryTimestamps: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model, compactionPoints: [], changeMarkers: [] };
  }
  if (leafId) targetLeaf = byId.get(leafId);
  if (!targetLeaf) targetLeaf = entries[entries.length - 1];
  if (!targetLeaf) {
    return { messages: [], entryIds: [], entryTimestamps: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model, compactionPoints: [], changeMarkers: [] };
  }

  const path: SessionEntry[] = [];
  let cur: SessionEntry | undefined = targetLeaf;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  const originByUserEntryId = new Map<string, unknown>();
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

  const visibleEntryIds = new Set(entryIds);
  const compactionPoints: CompactionPoint[] = [];
  for (const e of path) {
    if (e.type !== "compaction") continue;
    const ce = e as CompactionEntry;
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

  const changeMarkers: ChangeMarker[] = [];
  for (let i = 0; i < path.length; i++) {
    const e = path[i];
    if (e.type !== "model_change" && e.type !== "thinking_level_change") continue;
    let afterId: string | undefined;
    for (let j = i + 1; j < path.length; j++) {
      if (visibleEntryIds.has(path[j].id)) {
        afterId = path[j].id;
        break;
      }
    }
    const marker = e.type === "model_change"
      ? {
          entryId: e.id,
          kind: "model" as const,
          provider: e.provider,
          modelId: e.modelId,
          beforeMessageEntryId: afterId,
          timestamp: e.timestamp,
        }
      : {
          entryId: e.id,
          kind: "thinking_level" as const,
          thinkingLevel: e.thinkingLevel,
          beforeMessageEntryId: afterId,
          timestamp: e.timestamp,
        };
    changeMarkers.push(marker);
  }

  return {
    messages,
    entryIds,
    entryTimestamps,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
    compactionPoints,
    changeMarkers,
  };
}

export function resolveParentSessionId(parentSessionPath: string | undefined): string | undefined {
  if (!parentSessionPath) return undefined;
  return readHeaderOnly(parentSessionPath)?.id;
}

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
  }

  cache.set(sessionId, { mtimeMs, stats });
  return stats;
}

export type { SubagentActivityItem } from "@/lib/shared/types";
import type { SubagentActivityItem } from "@/lib/shared/types";

export interface SubagentLiveSnapshot {
  assistantCount: number;
  readCount: number;
  model: string | null;
  activities: SubagentActivityItem[];
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

const ACTIVITY_CACHE_LIMIT = SUBAGENT_ACTIVITY_MAX_LIMIT;

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
  }

  cache.set(sessionId, { mtimeMs, info });
  return limited(info);
}
