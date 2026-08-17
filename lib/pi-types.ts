import type { SessionManager, SettingsManager, AgentSessionEvent, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ToolInfo } from "./types";

// Re-exported so the existing `import type { ToolInfo } from "./pi-types"`
// call site in rpc-manager.ts keeps working. Single source of truth lives
// in lib/types.ts.
export type { ToolInfo };

interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
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

/** Narrowed shape of `AgentSession.compact()``s return value — a subset of
 *  `CompactionResult` from `@earendil-works/pi-coding-agent/dist/core/compaction/compaction.d.ts`.
 *  Pi's full type is generic and the outer RPC layer only forwards this subset. */
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
  readonly model: ModelLike | undefined;
  readonly modelRuntime: Pick<ModelRuntime, "getModel" | "getModels">;
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  readonly agent: { state?: { systemPrompt?: string; thinkingLevel?: string } };

  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string, options?: { images?: Array<{ type: "image"; data: string; mimeType: string }> }): Promise<void>;
  abort(): Promise<void>;
  setModel(model: ModelLike): Promise<void>;
  navigateTree(targetId: string, options?: { summarize?: boolean }): Promise<NavigateTreeResult>;
  setThinkingLevel(level: string): void;
  steer(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void>;
  followUp(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void>;
  getAllTools(): ToolInfo[];
  getActiveToolNames(): string[];
  setActiveToolsByName(names: string[]): void;
  getContextUsage(): ContextUsage | undefined;
  /** Manually trigger context compaction. Aborts any in-progress run first.
   *  Mirrors pi TUI's bare `/compact` — the optional `[focus]` tail is not
   *  surfaced by the web UI. Callers wanting to fully override the summary
   *  prompt should use the `session_before_compact` extension hook. */
  compact(): Promise<CompactResult>;
}
