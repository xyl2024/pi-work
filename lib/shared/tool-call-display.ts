// ============================================================================
// Tool call display (pure)
//
// The single source of the facts a view needs to draw one tool call:
//
//   - which kind it is (read / file mutation / bash / subagent / other);
//   - how many lines it added / deleted, and where that number comes from;
//   - whether its result counts as empty.
//
// `summarizeTurn` folds a whole turn into the read/edit/write chips plus the
// turn-level added/deleted total in one pass, and returns label-free data —
// the caller is the one that knows how to render or translate it.
//
// The added/deleted counts reuse `tool-diff-stats` (the implementation, not
// this seam). This module owns the *policy* on top of it: skip errored calls,
// take `edit` counts from the result details' diff payload and `write` counts
// from the tool input content.
//
// Like `panelTabs` and `chat-timeline` (ADR-0002 / ADR-0003) this module may
// not import React, i18n, a client hook, or anything from `lib/server`.
//
// Path resolution is deliberately NOT owned here: `resolveReadPath` needs the
// caller's cwd rules and stays where it is, so `summarizeTurn` takes it as a
// parameter and stays a pure function.
// ============================================================================

import { getFileName } from "./file-paths";
import {
  extractEditDiffStats,
  extractWriteDiffStats,
  sumDiffStats,
  type ToolDiffStats,
} from "./tool-diff-stats";
import type {
  AgentMessage,
  AssistantMessage,
  ReadFileInfo,
  TextContent,
  ToolCallContent,
  ToolResultMessage,
} from "./types";

/** The display category of one tool call. Only these five exist — views must
 *  not re-derive "is this a file mutation?" from a tool-name comparison. */
export type ToolCallKind = "read" | "file-mutation" | "bash" | "subagent" | "other";

/** Classify one tool call by name. Unknown tools are `"other"`. */
export function classifyToolCall(toolName: string): ToolCallKind {
  switch (toolName) {
    case "read":
      return "read";
    case "edit":
    case "write":
      return "file-mutation";
    case "bash":
      return "bash";
    case "spawn_subagent":
      return "subagent";
    default:
      return "other";
  }
}

/**
 * Added/deleted line counts for an `edit` / `write` call, or null when there
 * is nothing to count. Owns the policy: errored calls return null, `edit`
 * takes its counts from the result details' diff payload, `write` from the
 * tool input's written content. `edit` needs the result; `write` does not.
 */
export function toolCallDiffStats(
  toolCall: Pick<ToolCallContent, "toolName" | "input">,
  result?: ToolResultMessage,
): ToolDiffStats | null {
  if (result?.isError) return null;
  switch (toolCall.toolName) {
    case "edit":
      return extractEditDiffStats(result?.details);
    case "write":
      return extractWriteDiffStats(toolCall.input);
    default:
      return null;
  }
}

/**
 * Whether a tool result carries no meaningful output. A missing result (the
 * stream has not landed yet) is NOT empty — there is nothing to judge. pi's
 * `(no output)` marker and a blank/whitespace-only body both count as empty.
 */
export function isToolResultEmpty(result?: ToolResultMessage): boolean {
  if (!result) return false;
  const text = result.content
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
  return text === "" || text === "(no output)";
}

/** Resolves a raw tool path against the caller's cwd. Kept out of this module
 *  on purpose — the caller passes `resolveReadPath` (or equivalent) in. */
export type ToolPathResolver = (raw: string, cwd?: string | null) => string | null;

export interface TurnSummary {
  /** Files this turn read / edited / wrote, deduped by resolved path, in
   *  first-seen order. A file read and then edited is one read-first chip
   *  carrying the mutation's stats. */
  readFiles: ReadFileInfo[];
  /** Turn-level added/deleted total across every non-errored `edit` / `write`
   *  call; null when the turn touched nothing. */
  diffStats: ToolDiffStats | null;
}

/**
 * Summarize one turn's `messages` (the caller passes just the turn's slice) in
 * a single pass: the read/edit/write chips and the turn-level diff total come
 * from the same traversal, so the two can never disagree.
 *
 * Rules owned here: a file appears once (read-first; a later mutation attaches
 * its stats), errored calls are skipped everywhere, and every non-errored
 * mutation contributes to the total even when it has no resolvable path.
 */
export function summarizeTurn(
  messages: readonly AgentMessage[],
  resultsById: ReadonlyMap<string, ToolResultMessage>,
  cwd: string | null,
  resolvePath: ToolPathResolver,
): TurnSummary {
  const byPath = new Map<string, ReadFileInfo>();
  const readFiles: ReadFileInfo[] = [];
  const parts: Array<ToolDiffStats | null> = [];

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of (message as AssistantMessage).content ?? []) {
      if (block.type !== "toolCall") continue;
      const toolCall = block as ToolCallContent;

      const kind = classifyToolCall(toolCall.toolName);
      if (kind !== "read" && kind !== "file-mutation") continue;

      const result = resultsById.get(toolCall.toolCallId);
      if (result?.isError) continue;

      const diffStats = kind === "file-mutation" ? toolCallDiffStats(toolCall, result) : null;
      if (kind === "file-mutation") parts.push(diffStats);

      const raw = toolCall.input?.path;
      if (typeof raw !== "string" || !raw.trim()) continue;
      const resolved = resolvePath(raw.trim(), cwd);
      if (!resolved) continue;

      const existing = byPath.get(resolved);
      if (existing) {
        // Same file already chipped this turn — attach mutation stats if the
        // chip is still read-only; never add a second chip.
        if (diffStats && !existing.diffStats) existing.diffStats = diffStats;
        continue;
      }

      const entry: ReadFileInfo = { path: resolved, name: getFileName(resolved), diffStats };
      byPath.set(resolved, entry);
      readFiles.push(entry);
    }
  }

  return { readFiles, diffStats: sumDiffStats(parts) };
}
