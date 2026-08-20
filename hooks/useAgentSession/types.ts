import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { AgentMessage, CompactionPoint, SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ToolCallStatsDispatch } from "../ToolCallStatsContext";

export interface SessionData {
  sessionId: string;
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

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface AgentRuntimeState {
  running: boolean;
  state?: {
    isStreaming?: boolean;
    isCompacting?: boolean;
    isRunning?: boolean;
    phase?: "compacting" | "streaming" | null;
    contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
    systemPrompt?: string;
    thinkingLevel?: string;
  };
}

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | { kind: "compacting" }
  | null;

export type ThinkingLevelOption = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

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
  onScrollComplete?: () => void;
  isActive?: boolean;
  controllerId?: string;
}

export type ToastNotification = {
  kind?: "success" | "error" | "info";
  message: string;
  durationMs?: number;
};

export type StateSetter<T> = Dispatch<SetStateAction<T>>;
export type Ref<T> = MutableRefObject<T>;

export type SessionIdRef = Ref<string | null>;
export type EventHandlerRef = Ref<((event: AgentEvent) => void) | null>;
export type RuntimeStateRef = Ref<((sid?: string) => Promise<AgentRuntimeState | null>) | null>;
export type LoadContextRef = Ref<(sid: string, leafId: string | null) => Promise<void>>;
export type ToolCallNameRef = Ref<Map<string, string>>;
export type ToolCallArgsRef = Ref<Map<string, unknown>>;

export interface TransportRefs {
  eventSource: Ref<EventSource | null>;
  eventSourceSession: Ref<string | null>;
  generation: Ref<number>;
  reconnectTimer: Ref<ReturnType<typeof setTimeout> | null>;
  reconnectAttempt: Ref<number>;
  disposed: Ref<boolean>;
  sessionId: SessionIdRef;
  agentRunning: Ref<boolean>;
}

export interface SessionDataLoaderRefs {
  sessionId: SessionIdRef;
  loadContext: LoadContextRef;
  refreshAgentRuntimeState: RuntimeStateRef;
  /** Triggered on connect to refresh agent runtime state from the server. */
  agentRunning: Ref<boolean>;
}

export type SessionRuntimeStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "compacting" };
