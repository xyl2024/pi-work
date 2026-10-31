import { createAgentSession, createCodemodeExtension, createMcpExtension, DefaultResourceLoader, isToolCallEventType, ModelRuntime, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { cacheSessionPath, invalidateSessionListCache, stripSessionInfoNodes, fallbackSessionLeafId } from "./session-reader";
import type { AgentSessionLike, ContextUsage, ToolInfo } from "./pi-types";
import type { SessionEvent } from "../shared/session-events";
import { buildMessageOriginEntryData, isMessageOrigin, normalizeMessageOrigin, MESSAGE_ORIGIN_ENTRY_TYPE, type MessageOrigin } from "../shared/message-origin";
import { extractMessageText } from "../shared/message-content";
import type { AgentMessage } from "../shared/types";
import type { ToolSelection } from "../shared/types";
import type { WebToolSource } from "../shared/web-tools";
import { declarableToolNames, expandToolSelection, isDeclarableTool } from "../shared/tool-selection";
import {
  stripDefaultSystemPromptSections,
  stripPiDocumentationSection,
} from "../shared/system-prompt-segments";
import { createLogger, elapsedMs } from "./logger";
import { readConfig } from "./config";
import { loadMcpConfigForPiWork } from "./mcp-config";
import { loadPiWorkSkillsSafety } from "./pi-work-skills";
import path from "node:path";

import { recordCall } from "./token-audit-store";
import { getAuditModelRuntime, installLlmFetchAudit, runWithLlmAuditContext } from "./llm-audit";
import type { LlmAuditSource } from "../shared/llm-audit-types";
import type { ModelCallCommandOptions } from "../shared/token-audit-types";
import { writeSessionName, deleteSessionName } from "./session-names";
import {
  readSessionToolSelection,
  writeSessionToolSelection,
} from "./session-tools-config";
import { readCwdToolSelection } from "./cwd-tools-config";
import { buildAskUserQuestionsTool, ASK_USER_QUESTIONS_SYSTEM_PROMPT_BLOCK } from "./ask-user-questions-tool";
import { celebrateTool } from "./celebrate-tool";
import { getRegistry } from "./session-registry";
import { subagentWebTools } from "./web-tools";
import {
  composeAppendSystemPrompt,
  composeOverrideSystemPrompt,
  webToolGuidanceBlocks,
  type SystemPromptAppendMode,
} from "./web-tool-guidance";
import { piWorkCallTool } from "./self-tools/pi-work-call";
import { subagentTool, buildSubagentSystemPromptBlock } from "./subagent-tool";
import { stopAllSubagentTasksForParent, SUBAGENT_PARENT_STOPPED } from "./subagent-tasks";
import { SUBAGENT_TOOL_NAME, LEGACY_SPAWN_SUBAGENT_TOOL_NAME } from "../shared/subagent";
import type { AskUserQuestionsCancel, AskUserQuestionsDecision } from "../shared/ask-user-questions-tool-types";
import { evaluateDangerousCommand, getDangerousPatternTimeoutMs } from "./dangerous-patterns";
import {
  DEFAULT_PERMISSION_MODE,
  isBackgroundSessionSource,
  isPermissionMode,
  resolveBackgroundPermissionMode,
  type SessionPermissionMode,
} from "../shared/permission-mode";
import { readSessionPermissionMode, writeSessionPermissionMode } from "./session-permission-mode";
import { createPiWorkBashTool, createPiWorkPowerShellTool } from "./pi-shell-tools";
import { agentToolDenylist } from "./agent-tool-denylist";
import { notify } from "./notifications";
import { readSessionNotify } from "./session-notify";
import { computeContextComposition, type ContextComposition } from "../shared/context-composition";
import { getContextTokenCounter, type TokenCounter } from "./context-tokenizer";
import { getChannel } from "./channels/db";
import type { NotificationPayload, TaskNotification } from "../shared/notifications";
import { InteractionGates, type PermissionDecision } from "./interaction-gates";

const log = createLogger("rpc-manager");

export type AskUserQuestionsRequestEvent = Extract<SessionEvent, { type: "ask_user_questions_request" }>;

type EventListener = (event: SessionEvent) => void;

export type SendOptions = ModelCallCommandOptions;

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly destroyCallbacks = new Set<() => void>();
  private _alive = true;
  private _running = false;
  private compactInFlight = false;
  readonly gates: InteractionGates;
  private lastAssistantText = "";
  private _toolSelection: ToolSelection = "all";
  private _permissionMode: SessionPermissionMode = DEFAULT_PERMISSION_MODE;
  private readonly piDocsManaged: boolean;
  private readonly background: boolean;
  private contextComposition: ContextComposition | null = null;
  private compositionRefreshId = 0;
  private pendingPromptOrigins: ReturnType<typeof buildMessageOriginEntryData>[] = [];
  private compositionRefreshChain: Promise<void> = Promise.resolve();
  private lastCompositionInput: {
    anchoredTotalTokens: number | null;
    systemPrompt: string;
    toolCount: number;
    messageCount: number;
  } | null = null;

  constructor(
    public readonly inner: AgentSessionLike,
    public readonly source: LlmAuditSource = "user",
    public readonly cwd: string | null = null,
    permissionMode: SessionPermissionMode = DEFAULT_PERMISSION_MODE,
    options: { piDocsManaged?: boolean; background?: boolean } = {},
  ) {
    this._permissionMode = permissionMode;
    this.piDocsManaged = options.piDocsManaged ?? false;
    this.background = options.background ?? false;
    this.gates = new InteractionGates({
      emit: (event) => this.emit(event),
      permissionMode: () => this._permissionMode,
    });
  }

  private emit(event: SessionEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
      }
    }
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  get toolSelection(): ToolSelection {
    return this._toolSelection;
  }

  setToolSelection(selection: unknown): void {
    if (selection === "all") this._toolSelection = "all";
    else if (Array.isArray(selection) && selection.every((name) => typeof name === "string")) {
      this._toolSelection = [...(selection as string[])];
    }
  }

  applyActiveTools(): void {
    const allNames = this.inner.getAllTools().map((tool) => tool.name);
    const declarableSet = new Set(declarableToolNames(this.inner.getAllTools()));
    if (this._toolSelection === "all") {
      this.inner.setActiveToolsByName([...declarableSet]);
      return;
    }
    this.inner.setActiveToolsByName(
      (expandToolSelection(this._toolSelection, allNames) as string[]).filter((name) =>
        declarableSet.has(name),
      ),
    );
  }

  get permissionMode(): SessionPermissionMode {
    return this._permissionMode;
  }

  get isBackgroundSession(): boolean {
    return this.background;
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return this._running || this.compactInFlight || this.inner.isStreaming || this.inner.isCompacting;
  }

  getContextUsage(): ContextUsage | undefined {
    return this.inner.getContextUsage();
  }

  start(): void {
    log.info("agent wrapper started", {
      sessionId: this.sessionId,
      sessionFile: this.sessionFile || undefined,
    });
    this.unsubscribe = this.inner.subscribe((event: AgentSessionEvent) => {
      this.updateRunningState(event);
      this.resetIdleTimer();
      if (event.type === "agent_end") {
        this.logEmptyTerminalReply(event);
        this.scheduleContextCompositionRefresh();
      }
      if (event.type === "agent_start") {
        this.lastAssistantText = "";
      } else if (event.type === "message_end") {
        if ((event.message as { role?: string }).role === "user") {
          this.consumePromptOrigin(event);
        }
        const body = extractAssistantBodyText(event.message);
        if (body) this.lastAssistantText = body;
      } else if (event.type === "agent_end") {
        void this.deliverSessionNotify();
      }
      if (event.type === "message_end") {
        this.emitTreeUpdate();
        this.scheduleContextCompositionRefresh();
      }
      if (event.type === "session_info_changed") {
        const name = (event as { name?: unknown }).name;
        if (typeof name === "string" && name.trim()) {
          try {
            writeSessionName(this.sessionId, name);
          } catch (err) {
            log.warn("failed to mirror session name to sidecar", {
              sessionId: this.sessionId,
              error: String(err),
            });
          }
        } else if (name === "" || name === undefined || name === null) {
          deleteSessionName(this.sessionId);
        }
      }
      for (const l of this.listeners) l(event);
    });
    this.scheduleContextCompositionRefresh();
    this.resetIdleTimer();
  }

  private consumePromptOrigin(event: { message?: unknown }): void {
    if (this.pendingPromptOrigins.length === 0) return;
    const cutoff = Date.now() - 10 * 60_000;
    this.pendingPromptOrigins = this.pendingPromptOrigins.filter((p) => p.timestamp > cutoff);
    if (this.pendingPromptOrigins.length === 0) return;
    const text = extractMessageText(!event.message ? ({ role: "user", content: [] } as AgentMessage) : event.message as AgentMessage);
    const matchedIdx = this.pendingPromptOrigins.findIndex((p) => text.startsWith(p.messagePrefix));
    const idx = matchedIdx !== -1 ? matchedIdx : this.pendingPromptOrigins.length === 1 ? 0 : -1;
    if (idx === -1) return;
    const consumed = this.pendingPromptOrigins.splice(idx, 1)[0];
    (event as { origin?: MessageOrigin }).origin = consumed.origin;
    void Promise.resolve().then(() => {
      try {
        if (!this._alive) return;
        this.inner.sessionManager.appendCustomEntry(MESSAGE_ORIGIN_ENTRY_TYPE, consumed);
      } catch (err) {
        log.warn("failed to append message origin entry", { sessionId: this.sessionId, error: String(err) });
      }
    });
  }

  effectiveSystemPrompt(): string {
    const prompt = this.inner.systemPrompt ?? "";
    if (!this.piDocsManaged || !prompt || piDocsEnabled()) return prompt;
    return stripPiDocumentationSection(prompt);
  }

  private scheduleContextCompositionRefresh(): void {
    const refreshId = ++this.compositionRefreshId;
    this.compositionRefreshChain = this.compositionRefreshChain
      .then(async () => {
        if (refreshId !== this.compositionRefreshId || !this._alive) return;
        const agentState = this.inner.agent.state;
        const systemPrompt = this.effectiveSystemPrompt();
        const tools = agentState?.tools ?? [];
        const messages = agentState?.messages ?? [];
        const anchoredTotalTokens = this.getContextUsage()?.tokens ?? null;
        if (
          this.lastCompositionInput?.anchoredTotalTokens === anchoredTotalTokens &&
          this.lastCompositionInput.systemPrompt === systemPrompt &&
          this.lastCompositionInput.toolCount === tools.length &&
          this.lastCompositionInput.messageCount === messages.length
        ) {
          return;
        }
        let countTokens: TokenCounter;
        try {
          countTokens = await getContextTokenCounter();
        } catch {
          return;
        }
        if (refreshId !== this.compositionRefreshId || !this._alive) return;
        this.contextComposition = computeContextComposition({
          systemPrompt,
          tools,
          messages,
          anchoredTotalTokens,
          countTokens,
        });
        this.lastCompositionInput = {
          anchoredTotalTokens,
          systemPrompt,
          toolCount: tools.length,
          messageCount: messages.length,
        };
      })
      .catch((error) => {
        log.warn("context composition refresh failed", {
          sessionId: this.sessionId,
          error: String(error),
        });
      });
  }

  emitTreeUpdate(): void {
    try {
      const sm = this.inner.sessionManager;
      const treeEvent: SessionEvent = {
        type: "session_tree_update",
        tree: stripSessionInfoNodes(sm.getTree()),
        leafId: fallbackSessionLeafId(sm, sm.getLeafId()),
      };
      for (const l of this.listeners) {
        try {
          l(treeEvent);
        } catch {
        }
      }
    } catch (e) {
      log.warn("tree update emission failed", {
        sessionId: this.sessionId,
        error: String(e),
      });
    }
  }

  private logEmptyTerminalReply(event: Extract<SessionEvent, { type: "agent_end" }>): void {
    const messages = Array.isArray(event.messages) ? event.messages : [];
    const lastAssistant = [...messages].reverse().find((message) => (
      !!message && typeof message === "object" && (message as { role?: unknown }).role === "assistant"
    )) as { content?: unknown; stopReason?: unknown; usage?: unknown } | undefined;
    if (!lastAssistant || !Array.isArray(lastAssistant.content) || lastAssistant.content.length !== 0) return;

    const model = this.inner.model;
    log.warn("agent ended with an empty terminal assistant message", {
      sessionId: this.sessionId,
      provider: model?.provider ?? null,
      modelId: model?.id ?? null,
      stopReason: typeof lastAssistant.stopReason === "string" ? lastAssistant.stopReason : null,
      usage: lastAssistant.usage ?? null,
      messageCount: messages.length,
    });
  }

  private async deliverSessionNotify(): Promise<void> {
    const text = this.lastAssistantText;
    if (!text) return;
    const config = readSessionNotify(this.sessionId);
    if (!config) return;
    const channel = getChannel(config.channelId);
    if (!channel || channel.provider !== "wechat") return;
    const userId = channel.userId;
    if (!userId) return;

    let sessionName = "";
    try {
      sessionName = this.inner.sessionManager.getSessionName()?.trim() ?? "";
    } catch {
    }
    const taskName = sessionName || "Session notification";
    const notification: TaskNotification = {
      onSuccess: true,
      onError: false,
      onTimeout: false,
      channels: [{ type: "wechat", channelId: config.channelId, recipientId: userId }],
    };
    const payload: NotificationPayload = {
      taskId: this.sessionId,
      taskName,
      outcome: "success",
      text,
      detail: text,
    };
    try {
      await notify(notification, payload);
      log.debug("session reply notification delivered", {
        sessionId: this.sessionId,
        channelId: config.channelId,
        length: text.length,
      });
    } catch (err) {
      log.warn("session reply notification delivery failed", {
        sessionId: this.sessionId,
        channelId: config.channelId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private updateRunningState(event: SessionEvent): void {
    switch (event.type) {
      case "agent_start":
      case "compaction_start":
        this._running = true;
        break;
      case "agent_end":
        if (event.willRetry !== true) this._running = false;
        break;
      case "agent_settled":
      case "compaction_end":
        this._running = false;
        break;
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;

    if (this.isRunning()) return;

    this.idleTimer = setTimeout(() => {
      if (this.isRunning()) return;
      this.destroy();
    }, 10 * 60 * 1000);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): () => void {
    this.destroyCallbacks.add(cb);
    return () => this.destroyCallbacks.delete(cb);
  }

  snapshotPendingGates(): SessionEvent[] {
    return this.gates.snapshot();
  }

  async send(command: Record<string, unknown>, options: SendOptions = {}): Promise<unknown> {
    installLlmFetchAudit();
    return runWithLlmAuditContext(
      {
        sessionId: this.sessionId,
        source: this.source,
        ...(options.purpose ? { purpose: options.purpose } : {}),
        cwd: this.cwd,
        sessionName: this.inner.sessionManager.getSessionName() ?? null,
      },
      () => this.dispatch(command),
    );
  }

  private async dispatch(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;
    log.debug("agent command dispatch", { sessionId: this.sessionId, type });

    switch (type) {
      case "prompt": {
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const rawOrigin = (command as { origin?: unknown }).origin;
        if (rawOrigin !== undefined) {
          const origin = isMessageOrigin(rawOrigin) ? rawOrigin : normalizeMessageOrigin(rawOrigin);
          if (origin.kind !== "web") {
            this.pendingPromptOrigins.push(buildMessageOriginEntryData(command.message as string, origin));
          }
        }
        this.inner
          .prompt(command.message as string, promptImages?.length ? { images: promptImages } : undefined)
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            log.warn("prompt failed", { sessionId: this.sessionId, error });
            this.pendingPromptOrigins = [];
            for (const l of this.listeners) {
              try {
                l({ type: "prompt_failed", error: message });
              } catch {
              }
            }
          });
        return null;
      }

      case "abort":
        if (this.source !== "subagent") {
          stopAllSubagentTasksForParent(this.sessionId, SUBAGENT_PARENT_STOPPED);
        }
        await this.inner.abort();
        return null;

      case "compact": {
        if (
          this.compactInFlight ||
          this.isRunning() ||
          this.inner.isStreaming ||
          this.inner.isCompacting
        ) {
          throw new Error("Agent is busy; wait for the current operation to finish before compacting.");
        }
        this.compactInFlight = true;
        try {
          const result = await this.inner.compact();
          log.info("manual compact completed", {
            sessionId: this.sessionId,
            tokensBefore: result.tokensBefore,
            summaryLength: result.summary.length,
          });
          return {
            summary: result.summary,
            firstKeptEntryId: result.firstKeptEntryId,
            tokensBefore: result.tokensBefore,
            estimatedTokensAfter: result.estimatedTokensAfter,
            usage: result.usage
              ? {
                  input: result.usage.input,
                  output: result.usage.output,
                  cacheRead: result.usage.cacheRead,
                  cacheWrite: result.usage.cacheWrite,
                  totalTokens: result.usage.totalTokens,
                  cost: {
                    input: result.usage.cost.input,
                    output: result.usage.cost.output,
                    cacheRead: result.usage.cost.cacheRead,
                    cacheWrite: result.usage.cost.cacheWrite,
                    total: result.usage.cost.total,
                  },
                }
              : undefined,
          };
        } finally {
          this.compactInFlight = false;
        }
      }

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        const isStreaming = this.inner.isStreaming;
        const isCompacting = this.compactInFlight || this.inner.isCompacting;
        const isRunning = this.isRunning();
        if (!this.contextComposition) await this.compositionRefreshChain;
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming,
          isCompacting,
          isRunning,
          phase: isCompacting ? "compacting" : isRunning ? "streaming" : null,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: 0,
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          contextComposition: this.contextComposition,
          systemPrompt: this.effectiveSystemPrompt(),
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          permissionMode: this.permissionMode,
          background: this.isBackgroundSession,
          toolNames: this.toolSelection,
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        const runtime = this.inner.modelRuntime;
        const model = runtime.getModel(provider, modelId);
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        return { id: model.id, provider: model.provider };
      }
      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, {});
        if (!result.cancelled) {
          this.applyActiveTools();
          this.scheduleContextCompositionRefresh();
        }
        log.info("navigate tree completed", {
          sessionId: this.sessionId,
          targetId: command.targetId,
          cancelled: result.cancelled,
        });
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        return null;
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.filter((t) => isDeclarableTool(t)).map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
          exposure: t.exposure,
          parameters: t.parameters,
        }));
      }

      case "set_tools": {
        const toolNames = command.toolNames as ToolSelection;
        this.setToolSelection(toolNames);
        this.applyActiveTools();
        if (!writeSessionToolSelection(this.sessionId, toolNames)) {
          log.warn("failed to persist session tool selection", { sessionId: this.sessionId });
        }
        return null;
      }

      case "set_permission_mode": {
        const mode = command.mode;
        if (!isPermissionMode(mode)) {
          throw new Error(`Unknown permission mode: ${String(mode)}`);
        }
        if (this.background) {
          throw new Error("Permission mode is fixed for an unattended session");
        }
        this._permissionMode = mode;
        if (mode === "confirm") this.gates.clearSessionMemo();
        if (!writeSessionPermissionMode(this.sessionId, mode)) {
          log.warn("failed to persist session permission mode", {
            sessionId: this.sessionId,
            mode,
          });
        }
        this.emit({ type: "permission_mode_changed", mode });
        log.info("permission mode changed", { sessionId: this.sessionId, mode });
        return { mode };
      }

      case "permission_decision": {
        const toolCallId = command.toolCallId as string;
        const decision = command.decision as PermissionDecision;
        const resolved = this.gates.resolvePermission(toolCallId, decision);
        return { resolved };
      }

      case "ask_user_questions_decision": {
        const toolCallId = command.toolCallId as string;
        const decision = command.decision as
          | AskUserQuestionsDecision
          | AskUserQuestionsCancel;
        const resolved = this.gates.resolveUserInput(toolCallId, decision);
        return { resolved };
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    this._running = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.unsubscribe?.();
    for (const cb of this.destroyCallbacks) {
      try {
        cb();
      } catch (error) {
        log.warn("agent destroy callback failed", {
          sessionId: this.sessionId,
          error: String(error),
        });
      }
    }
    this.destroyCallbacks.clear();
    this.gates.invalidateAll();
    log.info("agent wrapper destroyed", {
      sessionId: this.sessionId,
      sessionFile: this.sessionFile || undefined,
    });
  }
}

function extractAssistantBodyText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as { role?: unknown; content?: unknown; stopReason?: unknown };
  if (m.role !== "assistant") return "";
  if (m.stopReason === "error") return "";
  const content = m.content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      parts.push(b.text.trim());
    }
  }
  return parts.join("\n\n");
}

declare global {
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export { getRpcSession, listRunningRpcSessions } from "./session-registry";
export { runTurnRpcSession, type RunTurnRpcSpec } from "./turn/rpc-factory";

type RpcThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

function piDocsEnabled(): boolean {
  try {
    return readConfig().load_pi_docs;
  } catch {
    return true;
  }
}

export interface StartRpcSessionOptions {
  model?: { provider: string; modelId: string };
  thinkingLevel?: RpcThinkingLevel;
  allowedToolNames?: string[];
  systemPromptPrefix?: string;
  systemPromptOverride?: string;
  stripDefaultSystemPromptSections?: boolean;
  persistToolSelection?: boolean;
  parentSessionId?: string;
  mcp?: boolean;
  permissionMode?: SessionPermissionMode;
}

export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: ToolSelection,
  source: "user" | "scheduled" | "subagent" = "user",
  options: StartRpcSessionOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const effectiveToolNames: ToolSelection =
    toolNames !== undefined
      ? toolNames
      : sessionFile
        ? readSessionToolSelection(sessionId) ?? readCwdToolSelection(cwd) ?? "all"
        : readCwdToolSelection(cwd) ?? "all";
  if (toolNames === undefined) {
    log.info("tool selection resolved for session start", {
      sessionId,
      sessionFile: sessionFile || undefined,
      requested: "unspecified",
      effectiveCount: effectiveToolNames === "all" ? "all" : effectiveToolNames.length,
    });
  }
  const registry = getRegistry();
  const locks = getLocks();
  const startedAt = Date.now();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) {
    log.debug("reuse live agent session", { sessionId });
    return { session: existing, realSessionId: sessionId };
  }

  const inflight = locks.get(sessionId);
  if (inflight) {
    log.debug("reuse inflight agent session start", { sessionId });
    return inflight;
  }

  const starting = (async () => {
    log.info("start agent session", {
      sessionId,
      sessionFile: sessionFile || undefined,
      cwd,
      requestedToolCount: effectiveToolNames === "all" ? "all" : effectiveToolNames?.length,
    });
    const { SessionManager, getAgentDir } = await import("@earendil-works/pi-coding-agent");
    const agentDir = getAgentDir();

    installLlmFetchAudit();
    const modelRuntime = getAuditModelRuntime(
      await ModelRuntime.create({
        authPath: path.join(agentDir, "auth.json"),
        modelsPath: path.join(agentDir, "models.json"),
      }),
    );
    const requestedModel = options.model
      ? modelRuntime.getModel(options.model.provider, options.model.modelId)
      : undefined;
    if (options.model && !requestedModel) {
      throw new Error(`Model not found: ${options.model.provider}/${options.model.modelId}`);
    }

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(
          cwd,
          undefined,
          options.parentSessionId ? { parentSession: options.parentSessionId } : undefined,
        );
    const isNewSession = !sessionFile;
    const piDocsManaged = !options.systemPromptPrefix && !options.systemPromptOverride;

    let capturedSessionId: string | null = null;
    const capturedSource: WebToolSource = source;
    const wrapperRef: { current: AgentSessionWrapper | null } = { current: null };
    const requestUserInputRef: { current: AgentSessionWrapper | null } = { current: null };
    let appendSystemPromptLoaderOption: string[] | undefined;
    let disabledSkillPaths = new Set<string>();
    let mcpProjectServers = false;
    let mcpStartupWaitMs = 3000;
    try {
      const cfg = readConfig();
      disabledSkillPaths = new Set(cfg.disabled_skills[cwd] ?? []);
      mcpProjectServers = cfg.mcp.project_servers;
      mcpStartupWaitMs = cfg.mcp.startup_wait_ms;
      if (options.systemPromptPrefix || options.systemPromptOverride || !cfg.append_system.enabled) {
        appendSystemPromptLoaderOption = [];
      }
    } catch {
    }
    const mcpEnabled = options.mcp
      ?? (source === "user" && !options.systemPromptPrefix && !options.systemPromptOverride);
    const promptAppendMode: SystemPromptAppendMode = options.systemPromptOverride
      ? "override"
      : options.systemPromptPrefix
        ? "prefix"
        : "default";
    const sessionHasTool = (name: string): boolean =>
      (!options.allowedToolNames || options.allowedToolNames.includes(name)) &&
      (effectiveToolNames === "all" ||
        effectiveToolNames.some((entry) =>
          entry === name || (entry.endsWith("*") && name.startsWith(entry.slice(0, -1))),
        ));
    const webPromptBlocks = source === "subagent" ? webToolGuidanceBlocks(sessionHasTool) : [];
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      ...(appendSystemPromptLoaderOption !== undefined
        ? { appendSystemPrompt: appendSystemPromptLoaderOption }
        : {}),
      appendSystemPromptOverride: (baseAppend) => {
        const sessionBlocks: string[] = [];
        if (promptAppendMode === "default") {
          if (sessionHasTool("ask_user_questions")) sessionBlocks.push(ASK_USER_QUESTIONS_SYSTEM_PROMPT_BLOCK);
          if (sessionHasTool(SUBAGENT_TOOL_NAME) || sessionHasTool(LEGACY_SPAWN_SUBAGENT_TOOL_NAME)) {
            sessionBlocks.push(buildSubagentSystemPromptBlock());
          }
        }
        return composeAppendSystemPrompt({
          mode: promptAppendMode,
          baseAppend,
          sessionBlocks,
          webBlocks: webPromptBlocks,
        });
      },
      noSkills: Boolean(options.systemPromptPrefix || options.systemPromptOverride),
      skillsOverride: (base) => ({
        ...base,
        skills: options.systemPromptPrefix || options.systemPromptOverride
          ? []
          : [
              ...base.skills.filter((skill) => !disabledSkillPaths.has(skill.filePath)),
              ...loadPiWorkSkillsSafety(),
            ].filter((skill) => !disabledSkillPaths.has(skill.filePath)),
      }),
      extensionFactories: [
        createCodemodeExtension(),
        ...(mcpEnabled
          ? [
              createMcpExtension({
                loadConfig: (ctx) =>
                  loadMcpConfigForPiWork({
                    agentDir,
                    cwd: ctx.cwd,
                    projectTrusted: mcpProjectServers,
                  }),
                startupWaitMs: mcpStartupWaitMs,
              }),
            ]
          : []),
        ...(options.systemPromptPrefix
          ? [(pi: { on: (event: "before_agent_start", handler: (event: { systemPrompt: string }) => { systemPrompt: string }) => void }) => {
              pi.on("before_agent_start", (event) => {
                const generatedPrompt = options.stripDefaultSystemPromptSections
                  ? stripDefaultSystemPromptSections(event.systemPrompt)
                  : event.systemPrompt;
                return {
                  systemPrompt: `${options.systemPromptPrefix}\n\n${generatedPrompt}`,
                };
              });
            }]
          : []),
        ...(options.systemPromptOverride
          ? [(pi: { on: (event: "before_agent_start", handler: (event: { systemPrompt: string }) => { systemPrompt: string }) => void }) => {
              pi.on("before_agent_start", () => ({
                systemPrompt: composeOverrideSystemPrompt(options.systemPromptOverride!, webPromptBlocks),
              }));
            }]
          : []),
        ...(piDocsManaged
          ? [
              (pi: { on: (event: "before_agent_start", handler: (event: { systemPrompt: string }) => { systemPrompt: string } | undefined) => void }) => {
                pi.on("before_agent_start", (event) => {
                  if (piDocsEnabled()) return undefined;
                  return { systemPrompt: stripPiDocumentationSection(event.systemPrompt) };
                });
              },
            ]
          : []),
        (pi) => {
          pi.on("tool_call", async (event) => {
            const isShellCall =
              isToolCallEventType("bash", event) || isToolCallEventType("powershell", event);
            if (!isShellCall) return;
            const command = event.input.command;
            const verdict = evaluateDangerousCommand(
              command,
              wrapperRef.current?.permissionMode ?? DEFAULT_PERMISSION_MODE,
            );
            if (verdict.kind === "self_protected") {
              log.warn("self-protection blocked shell command", { command, reason: verdict.reason });
              return {
                block: true,
                reason: `The command was blocked by self-protection: ${verdict.reason}. Don't try it again and tell the user what you want to do.`,
              };
            }
            if (verdict.kind !== "matched") return;
            const w = wrapperRef.current;
            if (!w) return;
            const outcome = await w.gates.runPermissionGate({
              toolCallId: event.toolCallId,
              rule: verdict.ruleName,
              command,
              what: `the dangerous-command rule "${verdict.ruleName}"`,
              timeoutMs: getDangerousPatternTimeoutMs(),
            });
            if (outcome.decision === "deny") {
              return { block: true, reason: outcome.reason };
            }
            return undefined;
          });
        },
        (pi) => {
          pi.on("message_end", (event) => {
            const ev = event as { message?: { role?: string; provider?: string; model?: string; api?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number } }; timestamp?: number; stopReason?: string; errorMessage?: string } };
            const msg = ev.message;
            if (!msg || msg.role !== "assistant") return;
            if (!capturedSessionId) return;
            const finalizedAt = msg.timestamp ?? Date.now();
            const hookAt = Date.now();
            const u = msg.usage ?? {};
            const c = u.cost ?? {};
            const input = u.input ?? 0;
            const output = u.output ?? 0;
            const read = u.cacheRead ?? 0;
            const write = u.cacheWrite ?? 0;
            const costIn = c.input ?? 0;
            const costOut = c.output ?? 0;
            const costRead = c.cacheRead ?? 0;
            const costWrite = c.cacheWrite ?? 0;
            const costTotal =
              c.total ?? costIn + costOut + costRead + costWrite;
            try {
              recordCall({
                sessionId: capturedSessionId,
                messageId: String(finalizedAt),
                source: capturedSource,
                provider: msg.provider ?? "unknown",
                modelId: msg.model ?? "unknown",
                api: msg.api ?? null,
                ts: finalizedAt,
                inputTokens: input,
                outputTokens: output,
                cacheReadTokens: read,
                cacheWriteTokens: write,
                costInput: costIn,
                costOutput: costOut,
                costRead,
                costWrite,
                costTotal,
                durationMs: Math.max(0, hookAt - finalizedAt),
                error: msg.stopReason === "error" ? (msg.errorMessage ?? "error") : null,
              });
            } catch (e) {
              log.warn("token-audit record failed", {
                sessionId: capturedSessionId,
                error: String(e),
              });
            }
          });
        },
        (pi) => {
          pi.on("before_agent_start", (event) => {
            if (
              effectiveToolNames !== "all" &&
              event.systemPromptOptions.selectedTools.length === 0
            ) {
              return { systemPrompt: "" };
            }
            return undefined;
          });
        },
      ],
    });
    await resourceLoader.reload();

    const { session: inner } = await createAgentSession({
      cwd,
      agentDir,
      sessionManager,
      modelRuntime,
      resourceLoader,
      ...(requestedModel ? { model: requestedModel } : {}),
      ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
      customTools: [
        createPiWorkBashTool(cwd),
        createPiWorkPowerShellTool(cwd),
        ...(capturedSource === "subagent" ? [] : [subagentTool]),
        ...subagentWebTools(capturedSource),
        ...buildAskUserQuestionsTool({
          requestUserInput: (toolCallId, questions) => {
            const w = requestUserInputRef.current;
            if (!w) {
              return Promise.reject(
                new Error("ask_user_questions wrapper not initialized"),
              );
            }
            return w.gates.requestUserInput({ toolCallId, questions, timeoutMs: null });
          },
          source: capturedSource,
        }),
        celebrateTool,
        piWorkCallTool,
      ],
      ...(options.allowedToolNames ? { tools: options.allowedToolNames } : {}),
      excludeTools: [...agentToolDenylist(process.platform)],
    });
    capturedSessionId = inner.sessionId as string;

    if (isNewSession) {
      invalidateSessionListCache();
    }

    if (mcpEnabled) {
      await inner.bindExtensions({});
    }

    const declarableNames = declarableToolNames(inner.getAllTools());

    if (effectiveToolNames === "all") {
      inner.setActiveToolsByName(declarableNames);
    } else if (Array.isArray(effectiveToolNames)) {
      const declarableSet = new Set(declarableNames);
      const expanded = (
        expandToolSelection(
          effectiveToolNames,
          inner.getAllTools().map((t: ToolInfo) => t.name),
        ) as string[]
      ).filter((name) => declarableSet.has(name));
      inner.setActiveToolsByName(expanded);

    }

    const background = isBackgroundSessionSource(source);
    const wrapper = new AgentSessionWrapper(
      inner,
      source,
      cwd,
      background
        ? resolveBackgroundPermissionMode(options.permissionMode)
        : readSessionPermissionMode(inner.sessionId),
      { piDocsManaged, background },
    );
    wrapper.setToolSelection(effectiveToolNames);
    wrapperRef.current = wrapper;
    requestUserInputRef.current = wrapper;
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);
    if (options.persistToolSelection !== false) {
      writeSessionToolSelection(realSessionId, effectiveToolNames);
    }

    wrapper.onDestroy(() => {
      registry.delete(realSessionId);
    });
    registry.set(realSessionId, wrapper);

    log.info("agent session started", {
      sessionId,
      realSessionId,
      sessionFile: realSessionFile,
      durationMs: elapsedMs(startedAt),
    });
    return { session: wrapper, realSessionId };
  })().catch((error) => {
    log.error("agent session start failed", {
      sessionId,
      sessionFile: sessionFile || undefined,
      cwd,
      error,
      durationMs: elapsedMs(startedAt),
    });
    throw error;
  }).finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}
