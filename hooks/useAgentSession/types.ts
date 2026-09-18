import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { AgentMessage, CompactionPoint, SessionInfo, SessionTreeNode, ToolSelection } from "@/lib/shared/types";
import type { ContextComposition } from "@/lib/shared/context-composition";
// The session-event protocol is declared once, in the shared layer, and used by
// both the client and the server — see lib/shared/session-events.ts.
import type { SessionEvent } from "@/lib/shared/session-events";
import type { ToolCallStatsDispatch } from "../ToolCallStatsContext";

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

export interface AgentRuntimeState {
  running: boolean;
  state?: {
    isStreaming?: boolean;
    isCompacting?: boolean;
    isRunning?: boolean;
    phase?: "compacting" | "streaming" | null;
    contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
    /** Local context-composition estimate anchored to `contextUsage.tokens`
     *  (ADR-0005). Computed server-side on `message_end`; absent on older
     *  servers and `null` until the first estimate lands. */
    contextComposition?: ContextComposition | null;
    systemPrompt?: string;
    thinkingLevel?: string;
    /** Raw tool selection the live agent is using ("all" | string[], patterns
     *  included). Absent on older servers; drives the tools button label. */
    toolNames?: ToolSelection;
  };
}

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_tools"; tools: { id: string; name: string; args?: Record<string, unknown> }[] }
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
