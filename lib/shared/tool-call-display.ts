import { getFileName } from "./file-paths";
import { LEGACY_SPAWN_SUBAGENT_TOOL_NAME, SUBAGENT_TOOL_NAME } from "./subagent";
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

const PREVIEW_PART_LIMIT = 80;
const PREVIEW_TOTAL_LIMIT = 160;

function previewPart(value: unknown): string {
  return String(value).slice(0, PREVIEW_PART_LIMIT);
}

type SubagentAction = "spawn" | "continue" | "wait" | "cancel" | "list" | "get";

function subagentActionOf(input: unknown): SubagentAction | null {
  if (!input || typeof input !== "object") return null;
  const action = (input as Record<string, unknown>).action;
  return action === "spawn" || action === "continue" || action === "wait"
    || action === "cancel" || action === "list" || action === "get"
    ? action
    : null;
}

function subagentPreviewParts(
  action: SubagentAction | null,
  record: Record<string, unknown>,
  str: (value: unknown) => string,
): string[] {
  switch (action) {
    case "continue":
      return [str(record.description) || str(record.session_id)];
    case "wait":
    case "cancel":
      return [str(record.task_id)];
    case "list":
      return [str(record.status)];
    case "get":
      return [str(record.task_id) || str(record.session_id)];
    case "spawn":
    default:
      return [str(record.subagent_name) || str(record.subagentType), str(record.description)];
  }
}

export function getToolTitle(block: { input?: unknown; toolName?: string }): { name: string; preview: string } {
  const name = block.toolName ?? "";
  const preview = getToolPreview(block);
  if (name !== SUBAGENT_TOOL_NAME) return { name, preview };
  const action = subagentActionOf(block.input);
  return { name: action ? `${name} ${action}` : name, preview };
}

export function getToolPreview(block: { input?: unknown; toolName?: string }): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input as Record<string, unknown>);
  if (keys.length === 0) return "";

  const record = input as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" && v.length > 0 ? v : "");

  let parts: string[];
  switch (block.toolName) {
    case "find":
    case "grep": {
      parts = [str(record.path), str(record.pattern)];
      break;
    }
    case "read":
    case "write":
    case "edit":
    case "ls": {
      parts = [str(record.path)];
      break;
    }
    case "bash": {
      parts = [str(record.command)];
      break;
    }
    case SUBAGENT_TOOL_NAME: {
      parts = subagentPreviewParts(subagentActionOf(input), record, str);
      break;
    }
    case LEGACY_SPAWN_SUBAGENT_TOOL_NAME: {
      parts = [str(record.subagent_name) || str(record.subagentType), str(record.description)];
      break;
    }
    default: {
      const fallbackKey =
        ["command", "path", "file_path", "pattern", "query", "symbol", "action", "url", "name"].find((k) => k in record) ?? keys[0];
      parts = [String(record[fallbackKey])];
    }
  }

  return parts
    .filter((p) => p.length > 0)
    .map(previewPart)
    .join(" · ")
    .slice(0, PREVIEW_TOTAL_LIMIT);
}
