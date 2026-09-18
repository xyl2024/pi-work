import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { AgentMessage, CompactionPoint, SessionInfo, SessionTreeNode, ToolInfo, ToolResultMessage, ToolSelection } from "@/lib/shared/types";
import type {
  AgentPhase,
  ContextUsage,
  RetryInfo,
  SessionSnapshotPayload,
  SessionStats,
} from "@/lib/shared/session-runtime-state";
import type { ThinkingLevelOption } from "@/lib/shared/thinking-level-utils";
// The session-event protocol is declared once, in the shared layer, and used by
// both the client and the server — see lib/shared/session-events.ts.
import type { SessionEvent } from "@/lib/shared/session-events";
// The session runtime state lives in the shared layer so it stays pure and
// testable; the hook holds one instance of it (see
// lib/shared/session-runtime-state.ts).
import type { ToolCallStatsDispatch } from "../ToolCallStatsContext";

export type { AgentPhase, ContextUsage, RetryInfo } from "@/lib/shared/session-runtime-state";

export interface SessionData {
  sessionId: string;
  info?: SessionInfo | null;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    entryTimestamps?: (number | undefined)[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
    compactionPoints?: CompactionPoint[];
  };
}

export interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

export type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

/**
 * The REST `get_state` payload — the body of the `client_snapshot` runtime
 * input. Declared once in the shared layer (the reducer consumes it); this is
 * the hook-side name, kept so callers do not have to reach across layers.
 */
export type AgentRuntimeState = SessionSnapshotPayload;

export type { ThinkingLevelOption } from "@/lib/shared/thinking-level-utils";

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  addImages: (files: File[]) => void;
}

export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onFirstAssistantReady?: () => void;
  modelsRefreshKey?: number;
  chatInputRef?: RefObject<ChatInputHandle | null>;
  setNewSessionModel?: (model: { provider: string; modelId: string } | null) => void;
  statsEmit?: ToolCallStatsDispatch;
  scrollToEntryId?: string | null;
  /**
   * The session-entry navigation finished: land the view at the end of the
   * reloaded branch. `useScrollFollow` implements it (it owns every chat
   * scroll write) and reports back to the shell from there.
   */
  onEntryNavigated?: () => void;
  isActive?: boolean;
  controllerId?: string;
}

export type ToastNotification = {
  kind?: "success" | "error" | "info" | "warning";
  message: string;
  durationMs?: number;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  icon?: boolean;
};

export type StateSetter<T> = Dispatch<SetStateAction<T>>;
export type Ref<T> = MutableRefObject<T>;

export type SessionIdRef = Ref<string | null>;
export type EventHandlerRef = Ref<((event: SessionEvent) => void) | null>;
export type RuntimeStateRef = Ref<((sid?: string) => Promise<AgentRuntimeState | null>) | null>;
export type LoadContextRef = Ref<(sid: string, leafId: string | null) => Promise<void>>;

export interface TransportRefs {
  eventSource: Ref<EventSource | null>;
  eventSourceSession: Ref<string | null>;
  generation: Ref<number>;
  reconnectTimer: Ref<ReturnType<typeof setTimeout> | null>;
  reconnectAttempt: Ref<number>;
  disposed: Ref<boolean>;
  sessionId: SessionIdRef;
  /** Reads the current runtime state's `agentRunning` synchronously — the
   *  transport needs it before the next render, and it is derived from the
   *  one runtime state object rather than a second ref. */
  isAgentRunning: () => boolean;
}

export interface SessionDataLoaderRefs {
  sessionId: SessionIdRef;
  loadContext: LoadContextRef;
  refreshAgentRuntimeState: RuntimeStateRef;
  /** Triggered on connect to refresh agent runtime state from the server. */
  isAgentRunning: () => boolean;
}

export type SessionRuntimeStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "compacting" };

/** One entry of the model catalog `/api/models` reports. */
export interface SessionModelOption {
  id: string;
  name: string;
  provider: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

/**
 * The hook's named return interface — the module's public surface, so it is
 * documented by its type rather than by a 50-key inline object literal.
 *
 * The raw runtime-state setters (`setActiveLeafId` / `setData` / `setMessages`)
 * and the streaming reducer's `dispatch` are deliberately absent: their only
 * consumer was the hook's own adapter, and handing them out let a caller change
 * state behind the reducer's back. Actions are the only way to move it.
 */
export interface UseAgentSessionResult {
  // Runtime state, projected out of the one state object.
  data: SessionData | null;
  loading: boolean;
  error: string | null;
  entryIds: string[];
  entryTimestamps: (number | undefined)[];
  compactionPoints: CompactionPoint[];
  inFlightToolResults: Map<string, ToolResultMessage>;
  streamState: StreamingState;
  runtimeError: string | null;
  activeLeafId: string | null;
  messages: AgentMessage[];
  agentRunning: boolean;
  agentPhase: AgentPhase;
  retryInfo: RetryInfo | null;
  contextUsage: ContextUsage | null;
  subagentRefreshKey: number;
  // Models and tools.
  modelNames: Record<string, string>;
  modelIcons: Record<string, string>;
  modelList: SessionModelOption[];
  modelThinkingLevels: Record<string, string[]>;
  modelThinkingLevelMaps: Record<string, Record<string, string | null>>;
  newSessionModel: { provider: string; modelId: string } | null;
  toolSelection: ToolSelection;
  availableTools: ToolInfo[];
  toolsLoading: boolean;
  toolsError: string | null;
  thinkingLevel: ThinkingLevelOption;
  systemPrompt: string | null;
  currentModel: { provider: string; modelId: string } | null;
  displayModel: { provider: string; modelId: string } | null;
  sessionStats: SessionStats;
  isNew: boolean;
  currentSessionId: string | null;
  userMessageHistory: string[];
  // Refs the chat window wires into scroll follow / drag & drop.
  sessionIdRef: MutableRefObject<string | null>;
  eventSourceRef: MutableRefObject<EventSource | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  lastUserMsgRef: RefObject<HTMLDivElement | null>;
  pendingScrollToUserRef: MutableRefObject<boolean>;
  userJustSentRef: MutableRefObject<boolean>;
  // Actions.
  handleSend: (message: string, images?: AttachedImage[]) => Promise<void>;
  handleAbort: () => Promise<void>;
  handleNavigate: (entryId: string) => Promise<void>;
  handleModelChange: (provider: string, modelId: string) => Promise<void>;
  handleToolSelectionChange: (selection: ToolSelection) => Promise<void>;
  ensureAvailableTools: () => Promise<void>;
  handleThinkingLevelChange: (level: ThinkingLevelOption) => Promise<void>;
  handleCompact: () => Promise<void>;
}
