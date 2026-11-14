import { statSync } from "fs";
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
import type { SessionEntry as PiSessionEntry } from "@earendil-works/pi-coding-agent";
import { isMessageOriginEntryData, MESSAGE_ORIGIN_ENTRY_TYPE } from "@/lib/shared/message-origin";
import { normalizeToolCalls } from "@/lib/shared/normalize";
import { cleanFirstMessage } from "@/lib/shared/session-title";
import {
  SUBAGENT_ACTIVITY_DEFAULT_LIMIT,
  SUBAGENT_ACTIVITY_MAX_LIMIT,
} from "@/lib/shared/subagent";
import { extractMessageText, readSessionHeader, type SessionHeaderScan } from "./header";
import {
  listSessionsFromIndex,
  invalidateSessionIndex,
  invalidateSessionIndexEntry,
  isSessionIndexLoaded,
  sessionPathFromIndex,
} from "./index-store";

export { readSessionHeader, isSessionIndexLoaded };
export type { SessionHeaderScan };
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

export function invalidateSessionListCache(): void {
  invalidateSessionIndex();
}

export async function listAllSessionsHeaderOnly(cwd?: string): Promise<SessionInfo[]> {
  const all = await listSessionsFromIndex();
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

  const fromIndex = await sessionPathFromIndex(sessionId);
  if (fromIndex) {
    getPathCache().set(sessionId, fromIndex);
    return fromIndex;
  }
  return null;
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  getPathCache().set(sessionId, filePath);
}

export function invalidateSessionPathCache(sessionId: string): void {
  getPathCache().delete(sessionId);
  invalidateSessionIndexEntry(sessionId);
}

export function isAssistantSessionFile(filePath: string): boolean {
  return readSessionHeader(filePath)?.assistant === true;
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
  return readSessionHeader(parentSessionPath)?.id;
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
  toolCallCount: number;
  readCount: number;
  model: string | null;
  provider: string | null;
}

export function summarizeSubagentSessionContext(context: SessionContext): SubagentSessionStats {
  let assistantCount = 0;
  let toolCallCount = 0;
  const readPaths = new Set<string>();
  let readCalls = 0;
  let model: string | null = null;
  for (const message of context.messages) {
    if (message.role !== "assistant") continue;
    assistantCount += 1;
    const assistant = message as AssistantMessage;
    if (assistant.model) model = assistant.model;
    for (const block of (normalizeToolCalls(message) as AssistantMessage).content) {
      if (block.type !== "toolCall") continue;
      toolCallCount += 1;
      if (block.toolName !== "read") continue;
      const path = block.input?.path;
      if (typeof path === "string" && path) {
        readPaths.add(path);
      } else {
        readCalls += 1;
      }
    }
  }
  return {
    assistantCount,
    toolCallCount,
    readCount: readPaths.size + readCalls,
    model: context.model?.modelId ?? model,
    provider: context.model?.provider ?? null,
  };
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

  let stats: SubagentSessionStats;
  try {
    const sm = SessionManager.open(filePath);
    const entries = sm.getEntries() as never;
    const leafId = fallbackSessionLeafId(sm, sm.getLeafId());
    stats = summarizeSubagentSessionContext(buildSessionContext(entries, leafId));
  } catch {
    return null;
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
