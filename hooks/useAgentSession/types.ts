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
import type { PermissionMode } from "@/lib/shared/permission-mode";
import type { SessionEvent } from "@/lib/shared/session-events";
import type { ComposerHandle } from "@/lib/client/composer/types";

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

export type AgentRuntimeState = SessionSnapshotPayload;

export type { ThinkingLevelOption } from "@/lib/shared/thinking-level-utils";

export type ChatInputHandle = ComposerHandle;

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
  chatInputRef?: RefObject<ComposerHandle | null>;
  setNewSessionModel?: (model: { provider: string; modelId: string } | null) => void;
  scrollToEntryId?: string | null;
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
  isAgentRunning: () => boolean;
}

export interface SessionDataLoaderRefs {
  sessionId: SessionIdRef;
  loadContext: LoadContextRef;
  refreshAgentRuntimeState: RuntimeStateRef;
  isAgentRunning: () => boolean;
}

export type SessionRuntimeStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "compacting" };

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

export interface UseAgentSessionResult {
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
  modelNames: Record<string, string>;
  modelIcons: Record<string, string>;
  modelIconPreferences: Record<string, string>;
  modelList: SessionModelOption[];
  modelThinkingLevels: Record<string, string[]>;
  modelThinkingLevelMaps: Record<string, Record<string, string | null>>;
  newSessionModel: { provider: string; modelId: string } | null;
  toolSelection: ToolSelection;
  availableTools: ToolInfo[];
  toolsLoading: boolean;
  toolsError: string | null;
  thinkingLevel: ThinkingLevelOption;
  permissionMode: PermissionMode;
  systemPrompt: string | null;
  currentModel: { provider: string; modelId: string } | null;
  displayModel: { provider: string; modelId: string } | null;
  sessionStats: SessionStats;
  isNew: boolean;
  currentSessionId: string | null;
  userMessageHistory: string[];
  sessionIdRef: MutableRefObject<string | null>;
  eventSourceRef: MutableRefObject<EventSource | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  lastUserMsgRef: RefObject<HTMLDivElement | null>;
  pendingScrollToUserRef: MutableRefObject<boolean>;
  userJustSentRef: MutableRefObject<boolean>;
  handleSend: (message: string, images?: AttachedImage[]) => Promise<void>;
  handleAbort: () => Promise<void>;
  handleNavigate: (entryId: string) => Promise<void>;
  handleModelChange: (provider: string, modelId: string) => Promise<void>;
  handleToolSelectionChange: (selection: ToolSelection) => Promise<void>;
  ensureAvailableTools: () => Promise<void>;
  handleThinkingLevelChange: (level: ThinkingLevelOption) => Promise<void>;
  handlePermissionModeChange: (mode: PermissionMode) => Promise<void>;
  handleCompact: () => Promise<void>;
}
