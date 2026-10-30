import type { AgentMessage, SessionTreeNode, ToolInfo, ToolSelection, ToolResultMessage } from "./types";
import type { ContextComposition } from "./context-composition";
import type { ThinkingLevelOption } from "./thinking-level-utils";
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from "./permission-mode";

export type StateUpdater<T> = T | ((previous: T) => T);

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_tools"; tools: { id: string; name: string; args?: Record<string, unknown> }[] }
  | { kind: "compacting" }
  | null;

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface SessionSnapshotPayload {
  running: boolean;
  state?: {
    isStreaming?: boolean;
    isCompacting?: boolean;
    isRunning?: boolean;
    phase?: "compacting" | "streaming" | null;
    contextUsage?: ContextUsage | null;
    contextComposition?: ContextComposition | null;
    systemPrompt?: string;
    thinkingLevel?: string;
    permissionMode?: PermissionMode;
    toolNames?: ToolSelection;
  };
}

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  errorMessage?: string;
}

export interface InFlightToolCall {
  name: string;
  args: unknown;
  result?: ToolResultMessage;
}

export interface SeenLedger {
  claim(id: string): boolean;
  has(id: string): boolean;
  clear(): void;
}

export function createSeenLedger(): SeenLedger {
  const seen = new Set<string>();
  return {
    claim(id: string): boolean {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    },
    has(id: string): boolean {
      return seen.has(id);
    },
    clear(): void {
      seen.clear();
    },
  };
}

export interface SessionRuntimeState {
  agentRunning: boolean;
  isCompacting: boolean;
  agentPhase: AgentPhase;
  runtimeError: string | null;
  activeLeafId: string | null;
  liveTree: SessionTreeNode[] | null;
  messages: AgentMessage[];
  inFlightTools: Map<string, InFlightToolCall>;
  subagentRefreshKey: number;
  thinkingLevel: ThinkingLevelOption;
  permissionMode: PermissionMode;
  retryInfo: RetryInfo | null;
  contextUsage: ContextUsage | null;
  contextComposition: ContextComposition | null;
  pendingAssistantError: string | null;
  lastAssistantIsBody: boolean;
  seenSubagentToolCallIds: SeenLedger;
  seenSubagentToolStartIds: SeenLedger;
  seenSubagentToolEndIds: SeenLedger;
  seenCelebrateToolEndIds: SeenLedger;
  seenAskUserQuestionsToolCallIds: SeenLedger;
  seenPermissionRequestToolCallIds: SeenLedger;
  awaitingFirstAssistant: boolean;
}

export function createSessionRuntimeState(
  overrides: Partial<SessionRuntimeState> = {},
): SessionRuntimeState {
  return {
    agentRunning: false,
    isCompacting: false,
    agentPhase: null,
    runtimeError: null,
    activeLeafId: null,
    liveTree: null,
    messages: [],
    inFlightTools: new Map(),
    subagentRefreshKey: 0,
    thinkingLevel: "off",
    permissionMode: DEFAULT_PERMISSION_MODE,
    retryInfo: null,
    contextUsage: null,
    contextComposition: null,
    pendingAssistantError: null,
    lastAssistantIsBody: false,
    seenSubagentToolCallIds: createSeenLedger(),
    seenSubagentToolStartIds: createSeenLedger(),
    seenSubagentToolEndIds: createSeenLedger(),
    seenCelebrateToolEndIds: createSeenLedger(),
    seenAskUserQuestionsToolCallIds: createSeenLedger(),
    seenPermissionRequestToolCallIds: createSeenLedger(),
    awaitingFirstAssistant: false,
    ...overrides,
  };
}

export function adoptDiskTranscript(
  current: AgentMessage[],
  disk: AgentMessage[],
): AgentMessage[] {
  if (current.length <= disk.length) return disk;
  return [...disk, ...current.slice(disk.length)];
}

export function patchSessionRuntimeState<K extends keyof SessionRuntimeState>(
  state: SessionRuntimeState,
  key: K,
  value: StateUpdater<SessionRuntimeState[K]>,
): SessionRuntimeState {
  const resolved = typeof value === "function"
    ? (value as (previous: SessionRuntimeState[K]) => SessionRuntimeState[K])(state[key])
    : value;
  if (Object.is(resolved, state[key])) return state;
  return { ...state, [key]: resolved };
}

export function upsertInFlightTool(
  inFlightTools: ReadonlyMap<string, InFlightToolCall>,
  id: string,
  name: string,
  args: unknown,
): Map<string, InFlightToolCall> {
  const existing = inFlightTools.get(id);
  const next = new Map(inFlightTools);
  next.set(id, {
    name,
    args,
    result: existing?.result ?? {
      role: "toolResult",
      toolCallId: id,
      toolName: name,
      content: [],
    },
  });
  return next;
}

export function mergeInFlightToolPartialResult(
  inFlightTools: ReadonlyMap<string, InFlightToolCall>,
  id: string,
  patch: { content?: ToolResultMessage["content"]; details?: unknown },
): Map<string, InFlightToolCall> | null {
  const existing = inFlightTools.get(id);
  if (!existing) return null;
  const next = new Map(inFlightTools);
  next.set(id, {
    ...existing,
    result: { ...existing.result, ...patch } as ToolResultMessage,
  });
  return next;
}

export function removeInFlightTool(
  inFlightTools: Map<string, InFlightToolCall>,
  id: string,
): Map<string, InFlightToolCall> {
  if (!inFlightTools.has(id)) return inFlightTools;
  const next = new Map(inFlightTools);
  next.delete(id);
  return next;
}

export function inFlightToolResultsOf(
  inFlightTools: ReadonlyMap<string, InFlightToolCall>,
): Map<string, ToolResultMessage> {
  const out = new Map<string, ToolResultMessage>();
  for (const [id, call] of inFlightTools) {
    if (call.result) out.set(id, call.result);
  }
  return out;
}

export type SessionStats = {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost?: number;
  cachedHitRate?: number;
} | null;

export interface SessionUiPublish {
  branchTree: SessionTreeNode[];
  branchActiveLeafId: string | null;
  systemPrompt: string | null;
  sessionStats: SessionStats;
  contextUsage: ContextUsage | null;
  contextComposition: ContextComposition | null;
  isStreaming: boolean;
  agentRunning: boolean;
  currentModel: { provider: string; modelId: string } | null;
  thinkingLevel: string;
  toolNames: string[];
  mainSessionMessages: AgentMessage[];
}

export interface SessionUiPublishSources {
  systemPrompt: string | null;
  sessionStats: SessionStats;
  isStreaming: boolean;
  diskTree: SessionTreeNode[];
  toolSelection: ToolSelection;
  availableTools: ToolInfo[];
  isNew: boolean;
  newSessionModel: { provider: string; modelId: string } | null;
  sessionModel: { provider: string; modelId: string } | null;
}

export function deriveSessionUiPublish(
  state: SessionRuntimeState,
  sources: SessionUiPublishSources,
  isActive: boolean,
): SessionUiPublish | null {
  if (!isActive) return null;
  return {
    branchTree: state.liveTree ?? sources.diskTree,
    branchActiveLeafId: state.activeLeafId,
    systemPrompt: sources.systemPrompt,
    sessionStats: sources.sessionStats,
    contextUsage: state.contextUsage,
    contextComposition: state.contextComposition,
    isStreaming: sources.isStreaming,
    agentRunning: state.agentRunning,
    currentModel: sources.isNew ? sources.newSessionModel : sources.sessionModel,
    thinkingLevel: state.thinkingLevel,
    toolNames: sources.toolSelection === "all"
      ? sources.availableTools.map((tool) => tool.name)
      : sources.toolSelection,
    mainSessionMessages: state.messages,
  };
}
