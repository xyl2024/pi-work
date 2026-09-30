import type { SessionManager, SettingsManager, AgentSessionEvent, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ToolInfo } from "../shared/types";
import type { SessionEventType } from "../shared/session-events";

// Re-exported so the existing `import type { ToolInfo } from "./pi-types"`
// call site in rpc-manager.ts keeps working. Single source of truth lives
// in lib/types.ts.
export type { ToolInfo };

type AssertTrue<T extends true> = T;

/**
 * Compile-time proof that the session-event protocol knows every event the pi
 * SDK can push: the SDK's event-type set must be a subset of ours.
 *
 * When a pi upgrade adds an event, this alias resolves to `never` and the file
 * stops compiling — which is the point. The fix is to add the type to
 * `lib/shared/session-events.ts` and decide whether the client reduces it or
 * deliberately ignores it (ADR-0007). Nothing is mapped at runtime: events
 * still pass through verbatim, so this assertion is the *only* thing that has
 * to be kept honest on the SDK side.
 *
 * It lives here, not in the shared layer, because `lib/shared` may not import
 * the pi SDK.
 */
export type PiSessionEventsAreKnownToProtocol = AssertTrue<
  AgentSessionEvent["type"] extends SessionEventType ? true : false
>;

/** What pi did with an input handed to a running session: `"handled"` when an
 *  extension consumed it, `"queued"` when it was queued behind the current
 *  turn. Mirrored here rather than imported because pi exports it from
 *  `core/agent-session` but not from the package root. `steer()` and
 *  `followUp()` return it since 0.99; this layer deliberately ignores the
 *  value (the UI learns the outcome from the events), but the mirror has to
 *  match or the structural cast to `AgentSession` stops compiling. */
export type QueuedInputDisposition = "handled" | "queued";

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

/** The subset of pi's `AgentTool` this layer reads: the API `tools` schema
 *  fields plus the sampling override `btw_context` forwards. The execute
 *  function and the rest of the runtime tool are none of our business. */
export interface AgentToolStateLike {
  name?: string;
  description?: string;
  parameters?: unknown;
  constrainedSampling?: unknown;
}

/** The subset of a pi `AgentMessage` context composition and `btw_context`
 *  read. `content` stays `unknown` because its block union is provider-shaped;
 *  `toolCallId`/`toolName` cover pairing a tool result with the call that
 *  produced it (the composition panel's Top-N list); `command`/`output`/`summary`
 *  cover the non-content message roles. */
export interface AgentMessageStateLike {
  role?: string;
  content?: unknown;
  /** toolResult: the call that produced this result. */
  toolCallId?: unknown;
  /** toolResult: the tool's own name, used when no matching call was found. */
  toolName?: unknown;
  command?: unknown;
  output?: unknown;
  /** `!!`-prefixed bash is excluded from the model request. */
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
  /** The session's current effective system prompt. Read it here, not from
   *  `agent.state.systemPrompt`: since pi 0.86 the agent-level prompt is
   *  replayed from the transcript's system messages, so it is empty until the
   *  first turn is persisted. `AgentSession.systemPrompt` renders the current
   *  prompt options and is correct from session creation onward. */
  readonly systemPrompt: string;
  readonly model: ModelLike | undefined;
  /** The session's thinking level — the `thinking_level` template variable. */
  readonly thinkingLevel?: string;
  readonly modelRuntime: Pick<ModelRuntime, "getModel" | "getModels">;
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  /** Mirror of the pi SDK `AgentState` fields this layer reads. `tools` and
   *  `messages` are typed here (rather than reached through a cast at each
   *  call site) because context composition and `btw_context` both consume
   *  them. */
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
  /** A registered tool's definition, for the prompt snippet / guidelines the
   *  `tools` and `rules` template variables need. Optional so test doubles do
   *  not have to implement it. */
  getToolDefinition?(
    name: string,
  ): { promptSnippet?: string; promptGuidelines?: string[] } | undefined;
  setActiveToolsByName(names: string[]): void;
  /**
   * Bind the extension runtime to this session and emit `session_start`.
   * pi's own CLI calls this at startup; SDK sessions have to opt in, and it is
   * the only thing that makes the built-in MCP extension read `mcp.json` and
   * connect its servers. The bindings themselves are optional: Pi Work passes
   * `{}`, which leaves pi's no-op UI context in place and only triggers the
   * event (see `lib/server/rpc-manager.ts`).
   */
  bindExtensions(bindings: object): Promise<void>;
  getContextUsage(): ContextUsage | undefined;
  /** Manually trigger context compaction. Aborts any in-progress run first.
   *  Mirrors pi TUI's bare `/compact` — the optional `[focus]` tail is not
   *  surfaced by the web UI. Callers wanting to fully override the summary
   *  prompt should use the `session_before_compact` extension hook. */
  compact(): Promise<CompactResult>;
}
