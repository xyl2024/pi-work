/**
 * Derive the Session Library entry list from a `messages` array.
 *
 * Each Session Library entry corresponds to one `show_file` tool call.
 * The UI uses the derived list to render the modal grid / image-preview /
 * detail-drawer (see `components/SessionLibraryModal.tsx` and friends).
 *
 * Truth sources:
 *
 * - `messages` — full conversation history. Each assistant message may
 *   contain a `toolCall` block with `toolName === "show_file"` and
 *   `input.paths: string[]`. We pull the `paths` from here.
 * - `showFileResults` — runtime-only cache keyed by toolCallId, populated
 *   in `useAgentSession` when a `tool_execution_end` event arrives. It
 *   contains the per-path `{ exists, category, size, error }` that the
 *   server returned inside `details.files`. We merge this into each entry
 *   so the grid can render success / failure / "Loading…" states
 *   correctly. (Session reload from `.jsonl` does not carry `details` —
 *   until the cache is repopulated, those entries fall back to a pending
 *   state.)
 *
 * Derivation order follows `messages` order so "first called → first in
 * the grid", matching the natural agent timeline.
 */

import { isShowFileToolName, categorizeByExt } from "./show-file-tool-types";
import type { ShowFileCategory, ShowFileEntry } from "./show-file-tool-types";
import type { AgentMessage, AssistantMessage, ToolCallContent, ToolResultMessage } from "./types";

export interface SessionLibraryEntryResult {
  path: string;
  exists: boolean;
  category: ShowFileCategory;
  size?: number;
  error?: string;
  /** True when the tool execution has produced a result (success or error).
   *  When false the entry is "pending" — the tool call was emitted but the
   *  result hasn't landed yet (still streaming). */
  resolved: boolean;
}

export interface SessionLibraryEntry {
  /** Matches `ToolCallContent.toolCallId` for the originating tool call. */
  toolCallId: string;
  /** Per-path results in the order they appear in `input.paths`. */
  paths: SessionLibraryEntryResult[];
  /** True if at least one path resolved successfully. */
  hasAnySuccess: boolean;
  /** True if every path in this entry resolved (no pending). */
  resolved: boolean;
  /** Index in `messages` — used for stable ordering and DOM focus. */
  messageIndex: number;
  /** Whether the originating tool result reported an error (show_file
   *  itself returns a structured result, but its `isError` flag signals
   *  schema violations etc.). */
  isError: boolean;
  /** Optional baseline text from `toolResult.content` — currently unused
   *  by the UI but exposed for future copy/summary affordances. */
  summary?: string;
}

/** Per-tool-call result cache. The key is `ToolCallContent.toolCallId`. */
export type ShowFileResultsMap = ReadonlyMap<string, readonly ShowFileEntry[]>;

function emptyResultsMap(): ShowFileResultsMap {
  return new Map();
}

/**
 * Build the Session Library entry list.
 *
 * @param messages Full `AgentMessage[]` (assistant + toolResult + user + ...).
 *   Streaming in-flight tool results should already be merged in by the
 *   caller (ChatWindow does this for its `renderMessages` list).
 * @param showFileResults Runtime cache of per-tool-call `details.files`,
 *   keyed by toolCallId. Defaults to an empty map — without it, every
 *   entry falls back to the "pending" state. Pass `useShowFileResults()`
 *   for the live cache.
 */
export function deriveSessionLibraryEntries(
  messages: AgentMessage[],
  showFileResults: ShowFileResultsMap = emptyResultsMap(),
): SessionLibraryEntry[] {
  // Index tool results by toolCallId so we can pick up the originating
  // tool call's `isError` flag in the same pass.
  const resultsByToolCallId = new Map<string, ToolResultMessage>();
  for (const m of messages) {
    if (m.role === "toolResult") {
      // Last write wins; in practice each toolCallId has exactly one result.
      resultsByToolCallId.set(m.toolCallId, m);
    }
  }

  const entries: SessionLibraryEntry[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;
    const assistantMsg = msg as AssistantMessage;
    const blocks = assistantMsg.content ?? [];

    for (const block of blocks) {
      if (block.type !== "toolCall") continue;
      const tc = block as ToolCallContent;
      if (!isShowFileToolName(tc.toolName)) continue;

      const rawPaths = (tc.input as { paths?: unknown })?.paths;
      if (!Array.isArray(rawPaths)) continue;
      const paths: string[] = [];
      for (const p of rawPaths) {
        if (typeof p === "string" && p.length > 0) paths.push(p);
      }
      if (paths.length === 0) continue;

      const toolResult = resultsByToolCallId.get(tc.toolCallId);
      const cachedFiles = showFileResults.get(tc.toolCallId);
      const hasResult = !!toolResult || !!cachedFiles;

      const pathResults: SessionLibraryEntryResult[] = paths.map((path) => {
        const detail = cachedFiles?.find((f) => f.path === path);
        if (detail) {
          return {
            path,
            exists: detail.exists,
            category: detail.category ?? categorizeByExt(path),
            size: detail.size,
            error: detail.error,
            resolved: true,
          };
        }
        // No detail yet — either still streaming or session reloaded and
        // the runtime cache is cold. Show as pending with category guessed
        // from the path so the grid still has something to display.
        return {
          path,
          exists: false,
          category: categorizeByExt(path),
          resolved: hasResult,
        };
      });

      const summaryText = toolResult
        ? toolResult.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("\n")
            .trim() || undefined
        : undefined;

      entries.push({
        toolCallId: tc.toolCallId,
        paths: pathResults,
        hasAnySuccess: pathResults.some((p) => p.resolved && p.exists),
        resolved: pathResults.every((p) => p.resolved),
        messageIndex: i,
        isError: toolResult?.isError ?? false,
        summary: summaryText,
      });
    }
  }

  return entries;
}

/** Filter an entries list by the active Session Library filter + search. */
export function filterSessionLibraryEntries(
  entries: SessionLibraryEntry[],
  filter: string,
  search: string,
): SessionLibraryEntry[] {
  const searchLc = search.trim().toLowerCase();
  return entries.filter((entry) => {
    // Apply filter
    switch (filter) {
      case "all":
        break;
      case "image":
        if (!entry.paths.some((p) => p.category === "image")) return false;
        break;
      case "video":
        if (!entry.paths.some((p) => p.category === "video")) return false;
        break;
      case "audio":
        if (!entry.paths.some((p) => p.category === "audio")) return false;
        break;
      case "failed":
        if (!entry.paths.some((p) => p.resolved && !p.exists)) return false;
        break;
      default:
        break;
    }
    // Apply search
    if (searchLc) {
      const hit = entry.paths.some((p) =>
        p.path.toLowerCase().includes(searchLc),
      );
      if (!hit) return false;
    }
    return true;
  });
}

/** Counts for the filter-bar badges (Q17B: N failed chip per type). */
export interface SessionLibraryCounts {
  total: number;
  byFilter: Record<string, number>;
  failed: number;
}

export function countSessionLibraryEntries(
  entries: SessionLibraryEntry[],
): SessionLibraryCounts {
  let failed = 0;
  const byFilter: Record<string, number> = {
    all: entries.length,
    image: 0,
    video: 0,
    audio: 0,
    failed: 0,
  };
  for (const entry of entries) {
    const cats = new Set<ShowFileCategory>();
    let entryHasFailed = false;
    for (const p of entry.paths) {
      cats.add(p.category);
      if (p.resolved && !p.exists) {
        failed++;
        entryHasFailed = true;
      }
    }
    if (cats.has("image")) byFilter.image++;
    if (cats.has("video")) byFilter.video++;
    if (cats.has("audio")) byFilter.audio++;
    if (entryHasFailed) byFilter.failed++;
  }
  return { total: entries.length, byFilter, failed };
}

/** Flatten entries into a single ordered path list — used by the grid
 *  view to render individual tiles (a single tool call with 3 images
 *  shows as 3 image tiles). Failed/pending entries each become one
 *  tile too so the user sees the per-path outcome. */
export interface SessionLibraryTile {
  entryToolCallId: string;
  path: string;
  category: ShowFileCategory;
  exists: boolean;
  resolved: boolean;
  size?: number;
  error?: string;
}

export function flattenSessionLibraryTiles(entries: SessionLibraryEntry[]): SessionLibraryTile[] {
  const out: SessionLibraryTile[] = [];
  for (const entry of entries) {
    for (const p of entry.paths) {
      out.push({
        entryToolCallId: entry.toolCallId,
        path: p.path,
        category: p.category,
        exists: p.exists,
        resolved: p.resolved,
        size: p.size,
        error: p.error,
      });
    }
  }
  return out;
}