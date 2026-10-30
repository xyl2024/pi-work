import type { SessionManager, SettingsManager, AgentSessionEvent, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ToolInfo } from "../shared/types";
import type { SessionEventType } from "../shared/session-events";

export type { ToolInfo };

type AssertTrue<T extends true> = T;

export type PiSessionEventsAreKnownToProtocol = AssertTrue<
  AgentSessionEvent["type"] extends SessionEventType ? true : false
>;

export type QueuedInputDisposition = "handled" | "queued";

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface AgentToolStateLike {
  name?: string;
  description?: string;
  parameters?: unknown;
  constrainedSampling?: unknown;
}

export interface AgentMessageStateLike {
  role?: string;
  content?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  command?: unknown;
  output?: unknown;
  excludeFromContext?: boolean;
  summary?: unknown;
}

interface ModelLike {
  id: string;
  provider: string;
}

interface NavigateTreeResult {
  editorText?: string;
  cancelled: boolean;
  aborted?: boolean;
}

export interface CompactResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  estimatedTokensAfter?: number;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  };
}

export interface AgentSessionLike {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly systemPrompt: string;
  readonly model: ModelLike | undefined;
  readonly modelRuntime: Pick<ModelRuntime, "getModel" | "getModels">;
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  readonly agent: {
    state?: {
      systemPrompt?: string;
      thinkingLevel?: string;
      tools?: AgentToolStateLike[];
      messages?: AgentMessageStateLike[];
    };
  };

  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string, options?: { images?: Array<{ type: "image"; data: string; mimeType: string }> }): Promise<void>;
  abort(): Promise<void>;
  setModel(model: ModelLike): Promise<void>;
  navigateTree(targetId: string, options?: { summarize?: boolean }): Promise<NavigateTreeResult>;
  setThinkingLevel(level: string): void;
  steer(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<QueuedInputDisposition>;
  followUp(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<QueuedInputDisposition>;
  getAllTools(): ToolInfo[];
  getActiveToolNames(): string[];
  setActiveToolsByName(names: string[]): void;
  bindExtensions(bindings: object): Promise<void>;
  getContextUsage(): ContextUsage | undefined;
  compact(): Promise<CompactResult>;
}
