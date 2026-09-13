/**
 * Per-task session stats for Kanban cards.
 *
 * Derives lightweight aggregates (message count, tool-call count, changed
 * file count, added/deleted lines) from the linked pi session's JSONL so the
 * board can show "how much did the agent do" without opening the session.
 *
 * The board polls /api/kanban every few seconds, so like the subagent stats in
 * lib/server/sessions/reader.ts results are cached per JSONL mtime — an
 * unchanged file is never re-parsed.
 */

import { statSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { buildSessionContext, fallbackSessionLeafId, resolveSessionPath } from "@/lib/server/sessions/index";
import type { KanbanTaskStats } from "@/lib/shared/kanban-types";
import { normalizeToolCalls } from "@/lib/shared/normalize";
import {
  extractEditDiffStats,
  extractMutatingPath,
  extractWriteDiffStats,
  sumDiffStats,
} from "@/lib/shared/tool-diff-stats";
import type {
  AssistantMessage,
  SessionContext,
  ToolCallContent,
  ToolResultMessage,
} from "@/lib/shared/types";

interface StatsCacheEntry {
  mtimeMs: number;
  stats: KanbanTaskStats | null;
}

declare global {
  var __piKanbanStatsCache: Map<string, StatsCacheEntry> | undefined;
}

function getStatsCache(): Map<string, StatsCacheEntry> {
  globalThis.__piKanbanStatsCache ??= new Map();
  return globalThis.__piKanbanStatsCache;
}

/** Exposed for tests / manual invalidation. */
export function invalidateKanbanStatsCache(sessionId?: string): void {
  const cache = getStatsCache();
  if (sessionId) cache.delete(sessionId);
  else cache.clear();
}

const EMPTY: KanbanTaskStats = {
  messageCount: 0,
  toolCallCount: 0,
  changedFileCount: 0,
  additions: 0,
  deletions: 0,
  runDurationMs: 0,
};

/**
 * Sum of per-turn wall-clock time across the active branch. A turn starts at
 * its user message and ends at the last entry belonging to that turn; the
 * (often long) idle gaps BETWEEN turns are excluded, so a session continued
 * with several prompts accumulates only actual run time.
 *
 * Timestamps: entry-level persistence timestamps (context.entryTimestamps,
 * parallel to messages) are the reliable source for every entry; the user
 * message's own runtime timestamp is preferred as the turn start when present
 * (same semantics as the chat UI's per-turn duration). Turns missing either
 * bound contribute nothing rather than voiding the whole sum.
 */
function sumRunDurationMs(context: SessionContext): number {
  const messages = context.messages;
  const entryTimestamps = context.entryTimestamps ?? [];
  const tsAt = (i: number): number | null => {
    const entry = entryTimestamps[i];
    if (typeof entry === "number" && Number.isFinite(entry)) return entry;
    const msg = messages[i]?.timestamp;
    return typeof msg === "number" && Number.isFinite(msg) ? msg : null;
  };

  let total = 0;
  let startMs: number | null = null;
  let lastMs: number | null = null;
  for (let i = 0; i < messages.length; i++) {
    const isUser = messages[i].role === "user";
    if (isUser) {
      // Close out the previous turn before starting the next one.
      if (startMs !== null && lastMs !== null && lastMs > startMs) {
        total += lastMs - startMs;
      }
      startMs = null;
      lastMs = null;
    }
    const ts = tsAt(i);
    if (ts === null) continue;
    if (startMs === null) {
      startMs = isUser ? (messages[i].timestamp ?? ts) : ts;
    }
    lastMs = ts;
  }
  if (startMs !== null && lastMs !== null && lastMs > startMs) {
    total += lastMs - startMs;
  }
  return total;
}

/**
 * Aggregate stats for one session's active branch. Returns null when the
 * session can't be resolved / read (e.g. mid-write JSONL), so the caller can
 * fall back to showing nothing rather than zeros that imply "nothing done".
 */
export async function readKanbanSessionStats(
  sessionId: string,
): Promise<KanbanTaskStats | null> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    return null;
  }

  const cache = getStatsCache();
  const cached = cache.get(sessionId);
  if (cached && cached.mtimeMs === mtimeMs) return cached.stats;

  let stats: KanbanTaskStats | null = EMPTY;
  try {
    const sm = SessionManager.open(filePath);
    const entries = sm.getEntries() as never;
    const leafId = fallbackSessionLeafId(sm, sm.getLeafId());
    const context = buildSessionContext(entries, leafId);

    let messageCount = 0;
    let toolCallCount = 0;
    const changedFiles = new Set<string>();
    const diffStats: Array<{ additions: number; deletions: number }> = [];

    // Map toolResult messages by id so each edit/write call can pull its diff
    // stats out of the result's `details` (edit) or its input (write).
    const resultsById = new Map<string, ToolResultMessage>();
    for (const message of context.messages) {
      if (message.role !== "toolResult") continue;
      const result = message as ToolResultMessage;
      if (result.toolCallId) resultsById.set(result.toolCallId, result);
    }

    for (const message of context.messages) {
      if (message.role !== "assistant") continue;
      messageCount += 1;
      const assistant = normalizeToolCalls(message) as AssistantMessage;
      for (const block of assistant.content) {
        if (block.type !== "toolCall") continue;
        const tc = block as ToolCallContent;
        toolCallCount += 1;
        if (tc.toolName !== "edit" && tc.toolName !== "write") continue;
        const result = resultsById.get(tc.toolCallId);
        const path = extractMutatingPath(tc.input);
        if (path) changedFiles.add(path);
        const item =
          tc.toolName === "edit"
            ? extractEditDiffStats(result?.details)
            : extractWriteDiffStats(tc.input);
        if (item) diffStats.push(item);
      }
    }

    const combined = sumDiffStats(diffStats);
    stats = {
      messageCount,
      toolCallCount,
      changedFileCount: changedFiles.size,
      additions: combined?.additions ?? 0,
      deletions: combined?.deletions ?? 0,
      runDurationMs: sumRunDurationMs(context),
    };
  } catch {
    // Unreadable / mid-write JSONL: treat as unavailable (null), not zeroed,
    // so the caller decides how to present it.
    stats = null;
  }

  cache.set(sessionId, { mtimeMs, stats });
  return stats;
}
