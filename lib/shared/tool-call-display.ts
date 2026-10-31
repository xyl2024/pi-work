import { getFileName } from "./file-paths";
import { extractMessageImages } from "./message-content";
import {
  extractEditDiffStats,
  extractWriteDiffStats,
  sumDiffStats,
  type ToolDiffStats,
} from "./tool-diff-stats";
import type {
  AgentMessage,
  AssistantMessage,
  NestedToolCallRecord,
  NestedToolCalls,
  ReadFileInfo,
  TextContent,
  ToolCallContent,
  ToolResultMessage,
} from "./types";

export type ToolCallKind = "read" | "file-mutation" | "bash" | "codemode" | "other";

export function classifyToolCall(toolName: string): ToolCallKind {
  switch (toolName) {
    case "read":
      return "read";
    case "edit":
    case "write":
      return "file-mutation";
    case "bash":
      return "bash";
    case "codemode":
      return "codemode";
    default:
      return "other";
  }
}

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

export interface NestedCallRow {
  id: string;
  name: string;
  status: NestedToolCallRecord["status"];
  durationMs?: number;
  error?: string;
}

export function projectNestedCalls(nestedCalls?: NestedToolCalls): NestedCallRow[] {
  if (!nestedCalls) return [];
  return nestedCalls.calls.map((call) => {
    const row: NestedCallRow = { id: call.id, name: call.name, status: call.status };
    if (call.durationMs !== undefined) row.durationMs = call.durationMs;
    if (call.error !== undefined) row.error = call.error;
    return row;
  });
}

export function isToolResultEmpty(result?: ToolResultMessage): boolean {
  if (!result) return false;
  if (extractMessageImages(result).length > 0) return false;
  const text = result.content
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
  return text === "" || text === "(no output)";
}

export type ToolPathResolver = (raw: string, cwd?: string | null) => string | null;

export interface TurnSummary {
  readFiles: ReadFileInfo[];
  diffStats: ToolDiffStats | null;
}

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
