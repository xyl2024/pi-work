import type { ToolDiffStats } from "./tool-diff-stats";
import type { PermissionMode } from "./permission-mode";
import type { MessageOrigin } from "./message-origin";

interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface ToolCallContent {
  type: "toolCall";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ReadFileInfo {
  path: string;
  name: string;
  diffStats?: ToolDiffStats | null;
}

export type AssistantContentBlock = TextContent | ImageContent | ThinkingContent | ToolCallContent;

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp?: number;
  origin?: MessageOrigin;
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContentBlock[];
  model: string;
  provider: string;
  stopReason?: string;
  errorMessage?: string;
  timestamp?: number;
  durationMs?: number;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName?: string;
  content: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
  timestamp?: number;
  durationMs?: number;
}

export type ToolExposure = "direct" | "model-only" | "codemode" | "deferred" | "hidden";

export interface ToolInfo {
  name: string;
  description: string;
  active?: boolean;
  exposure?: ToolExposure;
  parameters?: unknown;
}

export type ToolSelection = string[] | "all";

export interface CustomMessage {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: unknown;
  timestamp?: number;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomMessage;

export interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}

interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

export interface CompactionEntryDetails {
  readFiles: string[];
  modifiedFiles: string[];
}

export interface CompactionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export interface CompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: CompactionEntryDetails | unknown;
  fromHook?: boolean;
  usage?: CompactionUsage;
}

interface BranchSummaryEntry extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: unknown;
  fromHook?: boolean;
}

interface CustomEntry extends SessionEntryBase {
  type: "custom";
  customType: string;
  data?: unknown;
}

interface CustomMessageEntry extends SessionEntryBase {
  type: "custom_message";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  details?: unknown;
  display: boolean;
}

interface LabelEntry extends SessionEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}

interface SessionInfoEntry extends SessionEntryBase {
  type: "session_info";
  name?: string;
}

export type SessionEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry;

export interface SessionTreeNode {
  entry: SessionEntry;
  children: SessionTreeNode[];
  label?: string;
}

export interface SessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  parentSessionId?: string;
  running: boolean;
  permissionMode?: PermissionMode;
}

export const MAX_CONCURRENT_SUBAGENT_RUNS = 4;

export type SubagentTaskStatus =
  | "queued"
  | "creating"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type SubagentTerminalStatus = "completed" | "failed" | "cancelled" | "interrupted";
export const SUBAGENT_TERMINAL_STATUSES: readonly SubagentTerminalStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
];

export function isSubagentTerminalStatus(status: SubagentTaskStatus): status is SubagentTerminalStatus {
  return (SUBAGENT_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export type SubagentTaskOrigin = "tool" | "manual";

export interface SubagentTaskSummary {
  taskId: string;
  childSessionId: string | null;
  subagentName: string;
  description: string;
  status: SubagentTaskStatus;
  origin: SubagentTaskOrigin;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  assistantCount?: number | null;
  readCount?: number | null;
  model?: string | null;
}

export interface SubagentActivityItem {
  toolName: string;
  summary: string;
  timestamp: number | null;
}

export interface SessionContext {
  messages: AgentMessage[];
  entryIds: string[];
  entryTimestamps?: (number | undefined)[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
  compactionPoints?: CompactionPoint[];
  changeMarkers?: ChangeMarker[];
}

export interface CompactionPoint {
  entryId: string;
  tokensBefore: number;
  summary: string;
  beforeMessageEntryId?: string;
  timestamp?: string;
}

export type ModelChangeMarker = {
  entryId: string;
  kind: "model";
  provider: string;
  modelId: string;
  beforeMessageEntryId?: string;
  timestamp?: string;
};

export type ThinkingLevelChangeMarker = {
  entryId: string;
  kind: "thinking_level";
  thinkingLevel: string;
  beforeMessageEntryId?: string;
  timestamp?: string;
};

export type ChangeMarker = ModelChangeMarker | ThinkingLevelChangeMarker;

export interface SessionSearchResult {
  id: string;
  name?: string;
  cwd: string;
  modified: string;
  matchCount: number;
  snippet: string;
  firstMatchEntryId?: string;
  matchLocation: "name" | "content";
}

export interface SessionSearchResponse {
  results: SessionSearchResult[];
  hasMore: boolean;
}

export interface SessionSearchPagedResult extends SessionInfo {
  matchCount: number;
  snippet: string;
  matchLocation: "name" | "content";
}

export interface SessionSearchPagedResponse {
  results: SessionSearchPagedResult[];
  nextCursor: string | null;
  total: number;
}

export interface SessionMessageSearchResult {
  entryId: string;
  role: string;
  snippet: string;
  leafId: string;
  timestamp?: string;
}

export interface SessionMessageSearchResponse {
  results: SessionMessageSearchResult[];
  matchedEntryIds: string[];
  totalMatches: number;
}

export interface Workspace {
  cwd: string;
  lastUsed: string;
  totalSessions: number;
  runningCount: number;
  firstMessage: string;
  latestSessionName?: string;
}

export interface WorkspacesResponse {
  workspaces: Workspace[];
  totalSessions?: number;
  todaySessions?: SessionInfo[];
  nextCursor: string | null;
}

export const FAVORITES_TAB_ID = "favorites:global";
export const TRANSLATE_TAB_ID = "translate:global";
export const TOKENS_TAB_ID = "tokens:global";
export const GIT_DIFF_TAB_ID = "gitDiff:global";
export const CONVERSATION_TREE_TAB_ID = "conversationTree:global";
export const LLM_AUDIT_TAB_ID = "llmAudit:global";
export const CONTEXT_TAB_ID = "context:global";
export const MODELS_CONFIG_TAB_ID = "modelsConfig:global";
export const MCP_TAB_ID = "mcp:global";
export const SKILLS_TAB_ID = "skills:global";
export const SCHEDULER_TAB_ID = "scheduler:global";
export const CHANNELS_TAB_ID = "channels:global";
