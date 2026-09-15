import { createAgentSession, DefaultResourceLoader, isToolCallEventType, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { cacheSessionPath, invalidateSessionListCache, stripSessionInfoNodes, fallbackSessionLeafId } from "./session-reader";
import type { AgentSessionLike, ContextUsage, ToolInfo } from "./pi-types";
import type { ToolSelection } from "../shared/types";
import { expandToolSelection } from "../shared/tool-selection";
import type { ToolMarketId } from "../shared/tools-market";
import { createLogger, elapsedMs } from "./logger";
import { readConfig } from "./config";
import { loadPiWorkSkillsSafety } from "./pi-work-skills";
import path from "node:path";

import { recordCall } from "./token-audit-store";
import { getAuditModelRuntime, installLlmFetchAudit, runWithLlmAuditContext } from "./llm-audit";
import type { LlmAuditSource } from "../shared/llm-audit-types";
import { buildShowFileTool, SHOW_MEDIA_SYSTEM_PROMPT_BLOCK } from "./show-file-tool";
import { writeSessionName, deleteSessionName } from "./session-names";
import {
  readSessionToolSelection,
  writeSessionToolSelection,
} from "./session-tools-config";
import { readCwdToolSelection } from "./cwd-tools-config";
import { buildAskUserQuestionsTool, ASK_USER_QUESTIONS_SYSTEM_PROMPT_BLOCK, type UserInputResolution } from "./ask-user-questions-tool";
import { celebrateTool, CELEBRATE_SYSTEM_PROMPT_BLOCK } from "./celebrate-tool";
import { getRegistry } from "./session-registry";
import { piWorkCallTool } from "./self-tools/pi-work-call";
import {
  buildCodeGraphTools,
  CODEGRAPH_SYSTEM_PROMPT_BLOCK,
} from "./codegraph-tool";
import { spawnSubagentTool, SPAWN_SUBAGENT_SYSTEM_PROMPT_BLOCK } from "./subagent-tool";
import { CODEGRAPH_TOOL_IDS } from "../shared/codegraph-tool-ids";
import { buildWebAccessTools, WEB_SEARCH_SYSTEM_PROMPT_BLOCK, FETCH_CONTENT_SYSTEM_PROMPT_BLOCK } from "./web-access/tools";
import type { AskUserQuestion, AskUserQuestionsCancel, AskUserQuestionsDecision, AskUserQuestionsRequestPayload } from "../shared/ask-user-questions-tool-types";
import { readEnabledTools } from "./tools-market-config";
import { matchDangerousPattern, getDangerousPatternTimeoutMs } from "./dangerous-patterns";
import { matchSelfKillCommand } from "./self-protection";
import { createPiWorkBashTool } from "./pi-bash-tool";
import { notify } from "./notifications";
import { readSessionNotify } from "./session-notify";
import { computeContextComposition, type ContextComposition } from "../shared/context-composition";
import { getContextTokenCounter, type TokenCounter } from "./context-tokenizer";
import { getChannel } from "./channels/db";
import type { NotificationPayload, TaskNotification } from "../shared/notifications";

const log = createLogger("rpc-manager");

export type PermissionDecision = "allow_once" | "allow_similar" | "deny";

interface PendingPermission {
  resolve: (decision: PermissionDecision) => void;
  reject: (reason: string) => void;
  ruleName: string;
  command: string;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface PermissionRequestEvent {
  type: "permission_request";
  toolCallId: string;
  ruleName: string;
  command: string;
}

// ============================================================================
// Ask user questions (parallel to the permission queue above)
//
// The `ask_user_questions` custom tool blocks until the user answers a
// batch of structured questions or cancels. The tool calls
// `requestUserInput(toolCallId, questions)` (closure-bound per session);
// the wrapper emits a synthetic `ask_user_questions_request` SSE event,
// stores a Promise in `pendingUserInputs`, and resolves it when the
// client POSTs back an `ask_user_questions_decision` command.
//
// Distinct from `pendingPermissions` because the data shape, lifecycle,
// and front-end renderer are entirely different. We do NOT impose a
// timeout — the wrapper's idle timer (10 min) reaps abandoned requests
// on destroy, and the tool's AbortSignal handles explicit aborts.
// ============================================================================

interface PendingUserInput {
  resolve: (resolution: UserInputResolution) => void;
  reject: (reason: string) => void;
  questions: AskUserQuestion[];
  /** Epoch ms when the request was emitted (used by the UI for ordering). */
  ts: number;
}

export interface AskUserQuestionsRequestEvent {
  type: "ask_user_questions_request";
  toolCallId: string;
  questions: AskUserQuestion[];
  ts: number;
}

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly destroyCallbacks = new Set<() => void>();
  private _alive = true;
  // True between agent_start and agent_end (and during compaction). Spans the
  // whole turn including tool calls so the sidebar dot covers the full
  // "agent is busy" window, not just the model streaming phase.
  private _running = false;
  // Set synchronously before awaiting AgentSession.compact(). SDK compaction
  // state is not observable until compact() advances past its initial abort,
  // so this closes the same-tick race between concurrent compact requests.
  private compactInFlight = false;
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  private allowedThisSession: Set<string> = new Set();
  private pendingUserInputs: Map<string, PendingUserInput> = new Map();
  // Text of the latest assistant body reply of the current turn — used by
  // per-session reply notifications (see start() + deliverSessionNotify).
  // Reset on agent_start, updated on each assistant message_end.
  private lastAssistantText = "";
  // Raw tool selection that is live for this session — "all" or the string[]
  // exactly as the user picked it (trailing-`*` patterns included). Kept in
  // sync by set_tools and at session start, so `get_state` can hand the UI the
  // selection it needs to label the tools button: the expanded active-tool list
  // (getActiveToolNames) can't be mapped back to a named preset.
  private _toolSelection: ToolSelection = "all";
  // Local context-composition estimate (ADR-0005), rendered by `get_state` and
  // refreshed on `message_end` — never computed on a read path. See
  // `scheduleContextCompositionRefresh`.
  private contextComposition: ContextComposition | null = null;
  // Monotonic id + serialized promise chain: a newer refresh supersedes an
  // in-flight one, and the tokenizer's 2.4MB first load can never interleave
  // two writes into the cache.
  private compositionRefreshId = 0;
  private compositionRefreshChain: Promise<void> = Promise.resolve();
  // Last accepted refresh inputs, so a `message_end` that didn't move the
  // anchor (a tool result, say) costs nothing. Message/tool *counts* are
  // enough to notice an append: the transcript only ever grows, and a tool
  // change rebuilds the system prompt, which is compared in full.
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
  ) {}

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  /** The raw (un-expanded) tool selection live for this session. */
  get toolSelection(): ToolSelection {
    return this._toolSelection;
  }

  /** Record the raw selection the caller just applied. Malformed values are
   *  ignored so a bad RPC payload can't blank out the stored selection. */
  setToolSelection(selection: unknown): void {
    if (selection === "all") this._toolSelection = "all";
    else if (Array.isArray(selection) && selection.every((name) => typeof name === "string")) {
      this._toolSelection = [...(selection as string[])];
    }
  }

  isAlive(): boolean {
    return this._alive;
  }

  /** True while the agent is between agent_start and agent_end (or compacting). */
  isRunning(): boolean {
    return this._running || this.compactInFlight || this.inner.isStreaming || this.inner.isCompacting;
  }

  /** Context-window occupancy ({percent, contextWindow, tokens}) for the live
   *  session — the same value pi draws in the chat top-bar circle. Shared with
   *  the Kanban board so cards can mirror the circle without duplicating pi's
   *  estimation logic. */
  getContextUsage(): ContextUsage | undefined {
    return this.inner.getContextUsage();
  }

  start(): void {
    log.info("agent wrapper started", {
      sessionId: this.sessionId,
      sessionFile: this.sessionFile || undefined,
    });
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      // A running turn may legitimately spend far longer than the idle TTL in
      // one model request or tool call. Update state first so the idle reaper
      // is suspended for the entire active turn instead of detaching its SSE
      // listeners after ten quiet minutes.
      this.updateRunningState(event);
      this.resetIdleTimer();
      if (event.type === "agent_end") {
        this.logEmptyTerminalReply(event);
        // Safety net for the end of the turn: re-anchor with the final branch
        // state. A no-op when the `message_end` refresh already covered it
        // (the input dedupe below skips identical anchor + prompt).
        this.scheduleContextCompositionRefresh();
      }
      // Per-session reply notifications: track the last assistant body reply of
      // this turn (agent_start → agent_end) and, when the turn ends, forward it
      // to the session's configured notification channel. Only fires for
      // sessions that explicitly opted in on the new-session page — others have
      // no sidecar and this is a no-op.
      if (event.type === "agent_start") {
        this.lastAssistantText = "";
      } else if (event.type === "message_end") {
        const body = extractAssistantBodyText(event.message);
        if (body) this.lastAssistantText = body;
      } else if (event.type === "agent_end") {
        void this.deliverSessionNotify();
      }
      // Push the freshest conversation tree after every persisted message
      // (message_end is when pi writes the entry to the session file), so
      // the conversation-tree panel can render new cards without waiting
      // for the whole turn to finish (agent_end → full session reload).
      if (event.type === "message_end") {
        this.emitTreeUpdate();
        this.scheduleContextCompositionRefresh();
      }
      // Mirror the latest session display name into the sidecar index
      // (see lib/server/session-names.ts). The mutation path that
      // rewrites the JSONL in place ALSO writes the sidecar (it doesn't
      // emit session_info_changed), so this is the second-safety-net
      // path for renames that came in via the live SDK RPC.
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

  /**
   * Recompute the local context-composition estimate out of band and cache it
   * on this session. Called on `message_end` / `agent_end` / branch navigation
   * and once at startup — never from `get_state` itself, so a request path (and
   * therefore hover) only ever reads the cache.
   *
   * Deferred by one microtask on purpose: pi emits `message_end` *before* it
   * appends the message to the session manager, and the anchor walks that
   * branch — reading it synchronously here would anchor one message behind.
   * The continuation runs after pi's own synchronous persistence.
   */
  private scheduleContextCompositionRefresh(): void {
    const refreshId = ++this.compositionRefreshId;
    this.compositionRefreshChain = this.compositionRefreshChain
      .then(async () => {
        if (refreshId !== this.compositionRefreshId || !this._alive) return;
        const agentState = this.inner.agent.state;
        const systemPrompt = agentState?.systemPrompt ?? "";
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
          // Already logged by the tokenizer module; keep the previous cache
          // rather than blanking the tooltip.
          return;
        }
        if (refreshId !== this.compositionRefreshId || !this._alive) return;
        // The four top-level buckets (ADR-0005): system prompt (minus skills),
        // tool schemas, skills, messages. Every classified number is anchored
        // to the provider total; the system prompt is counted by prefix
        // differencing so `system prompt + skills` equals the whole exactly.
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

  /**
   * Emit a synthetic `session_tree_update` event carrying the session's
   * latest tree + leaf id. Called after every message_end, and once by the
   * SSE route on connect, so the conversation-tree panel renders new cards
   * in near-real-time instead of waiting for agent_end to reload the file.
   */
  emitTreeUpdate(): void {
    try {
      const sm = this.inner.sessionManager;
      const treeEvent: AgentEvent = {
        type: "session_tree_update",
        // Apply the same session_info cleanup the /api/sessions/[id] GET
        // performs, so the live tree matches the disk-loaded one. Without
        // this, a rename's session_info node (hung off the then-current
        // leaf) becomes a side-branch that misroutes buildConversationTree's
        // per-round children[0] walk — the round's final assistant gets
        // locked early and every intermediate message renders as a card.
        tree: stripSessionInfoNodes(sm.getTree()) as unknown,
        leafId: fallbackSessionLeafId(sm, sm.getLeafId()),
      };
      for (const l of this.listeners) {
        try {
          l(treeEvent);
        } catch {
          // listener errors must not break the event loop
        }
      }
    } catch (e) {
      log.warn("tree update emission failed", {
        sessionId: this.sessionId,
        error: String(e),
      });
    }
  }

  /**
   * A successful HTTP stream can still become an empty terminal assistant
   * message after provider/adapter processing. Emit only safe metadata here;
   * paired with llm-audit's SSE-terminal log this makes the next occurrence
   * attributable without logging prompts, replies, or tool arguments.
   */
  private logEmptyTerminalReply(event: AgentEvent): void {
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

  /**
   * Forward this turn's final assistant reply to the session's configured
   * notification channel (set on the new-session page). Reads the sidecar at
   * send time so a channel re-scan / config update is always picked up.
   * No-op when the session has no notification config or the reply is empty.
   */
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
      // ignore — fall back to a generic label
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

  private updateRunningState(event: AgentEvent): void {
    switch (event.type) {
      case "agent_start":
      case "compaction_start":
      case "auto_compaction_start":
        this._running = true;
        break;
      case "agent_end":
        // A retryable attempt ends before the overall agent run settles.
        if (event.willRetry !== true) this._running = false;
        break;
      case "agent_settled":
      case "compaction_end":
      case "auto_compaction_end":
        this._running = false;
        break;
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;

    // The TTL is for inactive wrappers only. In particular, do not treat a
    // silent long-running tool/model request as an abandoned browser session:
    // destroy() unsubscribes the wrapper but does not abort the underlying
    // AgentSession, which otherwise makes the UI look interrupted while the
    // agent can still continue and eventually finish in the background.
    if (this.isRunning()) return;

    this.idleTimer = setTimeout(() => {
      // An event can start a turn just as this callback is queued. Never reap
      // an active wrapper in that race; its terminal event will arm the idle
      // timer again.
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

  /**
   * Block a tool call until the user makes a decision. Emits a synthetic
   * permission_request event to subscribers and returns a promise that
   * resolves with the user's decision (or 'deny' on timeout / destroy).
   */
  requestPermission(toolCallId: string, ruleName: string, command: string): Promise<PermissionDecision> {
    if (this.pendingPermissions.has(toolCallId)) {
      // Idempotent: a re-entry shouldn't happen, but if it does, return the existing promise.
      return new Promise<PermissionDecision>((resolve, reject) => {
        const existing = this.pendingPermissions.get(toolCallId)!;
        existing.resolve = (d) => { resolve(d); existing.resolve = () => {}; };
        existing.reject = (r) => { reject(r); existing.reject = () => {}; };
      });
    }
    const timeoutMs = getDangerousPatternTimeoutMs();
    const promise = new Promise<PermissionDecision>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const pending = this.pendingPermissions.get(toolCallId);
        if (!pending) return;
        this.pendingPermissions.delete(toolCallId);
        log.warn("permission request timed out, auto-denying", { toolCallId, ruleName });
        resolve("deny");
      }, timeoutMs);
      const entry: PendingPermission = {
        resolve,
        reject,
        ruleName,
        command,
        timeoutHandle,
      };
      this.pendingPermissions.set(toolCallId, entry);
    });
    const event: PermissionRequestEvent = {
      type: "permission_request",
      toolCallId,
      ruleName,
      command,
    };
    for (const l of this.listeners) {
      try {
        l(event as unknown as AgentEvent);
      } catch {
        // listener errors must not break permission flow
      }
    }
    log.info("permission requested", { toolCallId, ruleName });
    return promise;
  }

  resolvePermission(toolCallId: string, decision: PermissionDecision): boolean {
    const pending = this.pendingPermissions.get(toolCallId);
    if (!pending) return false;
    this.pendingPermissions.delete(toolCallId);
    clearTimeout(pending.timeoutHandle);
    if (decision === "allow_similar") this.allowedThisSession.add(pending.ruleName);
    pending.resolve(decision);
    log.info("permission resolved", { toolCallId, decision });
    return true;
  }

  isRuleAllowedThisSession(ruleName: string): boolean {
    return this.allowedThisSession.has(ruleName);
  }

  /**
   * Block the calling tool until the user answers the given batch of
   * questions (or cancels). Emits a synthetic `ask_user_questions_request`
   * SSE event and returns a Promise that resolves with the user's
   * answers — or `{kind: "cancelled"}` if they clicked Cancel.
   *
   * No timeout is imposed: the tool's AbortSignal handles explicit aborts,
   * and `destroy()` rejects pending entries when the wrapper is reaped.
   * The tool wrapper treats either rejection as an error result for the
   * agent (no hangs).
   */
  requestUserInput(
    toolCallId: string,
    questions: AskUserQuestion[],
  ): Promise<UserInputResolution> {
    if (this.pendingUserInputs.has(toolCallId)) {
      // Idempotent: return the existing promise for a re-entry (shouldn't
      // happen for a unique toolCallId, but defensive).
      return new Promise<UserInputResolution>((resolve, reject) => {
        const existing = this.pendingUserInputs.get(toolCallId)!;
        existing.resolve = (r) => { resolve(r); existing.resolve = () => {}; };
        existing.reject = (reason) => { reject(reason); existing.reject = () => {}; };
      });
    }
    const promise = new Promise<UserInputResolution>((resolve, reject) => {
      const entry: PendingUserInput = {
        resolve,
        reject,
        questions,
        ts: Date.now(),
      };
      this.pendingUserInputs.set(toolCallId, entry);
    });
    const event: AskUserQuestionsRequestEvent = {
      type: "ask_user_questions_request",
      toolCallId,
      questions,
      ts: Date.now(),
    };
    for (const l of this.listeners) {
      try {
        l(event as unknown as AgentEvent);
      } catch {
        // listener errors must not break the request flow
      }
    }
    log.info("ask_user_questions request emitted", {
      toolCallId,
      questionCount: questions.length,
    });
    return promise;
  }

  /**
   * Resolve a pending ask_user_questions request. Called when the client
   * POSTs back an `ask_user_questions_decision` command.
   *
   * The decision is either `{cancelled: true}` (user clicked Cancel) or
   * `{answers: AskUserQuestionAnswer[]}` (user submitted answers, possibly
   * empty for non-required questions they skipped).
   */
  resolveUserInput(
    toolCallId: string,
    decision: AskUserQuestionsDecision | AskUserQuestionsCancel,
  ): boolean {
    const pending = this.pendingUserInputs.get(toolCallId);
    if (!pending) return false;
    this.pendingUserInputs.delete(toolCallId);
    if ("cancelled" in decision && decision.cancelled) {
      pending.resolve({ kind: "cancelled" });
      log.info("ask_user_questions cancelled", { toolCallId });
    } else if ("answers" in decision) {
      pending.resolve({ kind: "answered", answers: decision.answers });
      log.info("ask_user_questions answered", {
        toolCallId,
        answerCount: decision.answers.filter((a) => a.selectedLabels.length > 0).length,
      });
    } else {
      // Defensive: unknown decision shape — treat as cancel to unblock.
      pending.resolve({ kind: "cancelled" });
      log.warn("ask_user_questions unknown decision shape, treated as cancel", {
        toolCallId,
      });
    }
    return true;
  }

  /** Snapshot of pending ask_user_questions requests for this wrapper.
   *  Used by the /api/agent/[id]/events route to re-emit after SSE
   *  reconnect so a refresh-mid-question doesn't lose the question. */
  snapshotPendingUserInputs(): AskUserQuestionsRequestPayload[] {
    const out: AskUserQuestionsRequestPayload[] = [];
    for (const [toolCallId, pending] of this.pendingUserInputs) {
      out.push({
        toolCallId,
        questions: pending.questions,
        ts: pending.ts,
      });
    }
    return out;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    // Every command runs inside an LLM-audit context so the fetch patch can
    // attribute each provider call to this session (AsyncLocalStorage
    // propagates through the whole prompt → agent-loop → stream → fetch chain,
    // including fire-and-forget prompts and pi-internal auto-compaction calls).
    // cwd + sessionName are snapshotted at command time for audit attribution.
    // Re-install the fetch patch defensively: after an HMR reload of llm-audit.ts
    // the running session's wrapper may still be old-code, so we make sure the
    // active patch is the newest incarnation before dispatching.
    installLlmFetchAudit();
    return runWithLlmAuditContext(
      {
        sessionId: this.sessionId,
        source: this.source,
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
        // Fire and forget — events come via subscribe. Rejections surface
        // as a synthetic prompt_failed event so the client can react instead
        // of silently hanging (e.g. missing API key, unregistered model).
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        this.inner
          .prompt(command.message as string, promptImages?.length ? { images: promptImages } : undefined)
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            log.warn("prompt failed", { sessionId: this.sessionId, error });
            for (const l of this.listeners) {
              try {
                l({ type: "prompt_failed", error: message } as unknown as AgentEvent);
              } catch {
                // listener errors must not break the dispatch loop
              }
            }
          });
        return null;
      }

      case "abort":
        await this.inner.abort();
        return null;

      case "compact": {
        // Manual compaction. Mirrors pi TUI's bare `/compact` (the optional
        // `[focus]` tail the kernel previously accepted was dropped to match
        // the simplified UI). Pi's `AgentSession.compact()` first aborts any
        // in-progress agent run, then synchronously waits for the summary
        // call to finish and emits `compaction_start` / `compaction_end` via
        // the same `subscribe()` channel that the SSE route forwards. The
        // compact() promise resolves with the persisted `CompactionResult`,
        // which we narrow to the subset the UI actually needs.
        //
        // Front-end should refuse to dispatch when `agentRunning` is true on a
        // different path (UI button + slash command gated on !isStreaming);
        // if it slips through, the upstream abort() makes the call safe but
        // cancels the user's in-flight turn, which we treat as a caller bug.
        //
        // Server-side guard for multi-tab / stale-widget races: if the
        // session is actually mid-turn, refuse instead of aborting the user's
        // in-flight work (the kernel's compact() would abort it).
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
        // Startup/wrapper-reuse path: the cache is filled asynchronously (the
        // tokenizer is a dynamic import), and nothing else would wake an idle
        // session up to publish it. Joining that in-flight refresh here is
        // still a cache read — it never starts a new computation.
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
          // Local estimate of what the context is made of (ADR-0005) — the
          // exact total stays in `contextUsage` above; every classified number
          // is anchored to it. `null` until the first refresh lands.
          contextComposition: this.contextComposition,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          // Raw selection (patterns included) — lets the UI render the active
          // preset label instead of re-deriving it from the expanded tool list.
          toolNames: this.toolSelection,
        };
      }

      case "btw_context": {
        // Snapshot of the main session's LIVE model-request inputs, used by
        // the BTW panel to replay the exact same systemPrompt / messages /
        // tools to the provider (pure chat, no agent loop) so prompt-cache
        // prefixes line up. Reads the underlying SDK Agent state directly
        // (state.messages carries SDK-shaped blocks incl. thinking
        // signatures + toolCall id/name/arguments) — not the UI-rendered
        // transcript, which would drop those fields.
        const agentState = this.inner.agent.state;
        const model = this.inner.model;
        const tools = (agentState?.tools ?? []).map((t) => {
          const out: Record<string, unknown> = {
            name: typeof t.name === "string" ? t.name : "",
            description: typeof t.description === "string" ? t.description : "",
            parameters: t.parameters,
          };
          if (t.constrainedSampling !== undefined) {
            out.constrainedSampling = t.constrainedSampling;
          }
          return out;
        });
        return {
          model: model ? { provider: model.provider, id: model.id } : undefined,
          systemPrompt: agentState?.systemPrompt ?? "",
          thinkingLevel: agentState?.thinkingLevel ?? "off",
          tools,
          messages: agentState?.messages ?? [],
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
        // The leaf changed, so the anchor (which walks the current branch) did
        // too — re-anchor the cached composition to the branch being shown.
        if (!result.cancelled) this.scheduleContextCompositionRefresh();
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
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
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
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "set_tools": {
        const toolNames = command.toolNames as ToolSelection;
        if (toolNames === "all") {
          this.inner.setActiveToolsByName(this.inner.getAllTools().map((t) => t.name));
        } else if (Array.isArray(toolNames)) {
          // Entries may carry trailing-`*` prefix patterns (e.g. "codegraph_*");
          // resolve them against the live registry before applying. The raw
          // selection (patterns included) is what gets persisted below, so a
          // restart re-expands against the then-current registry.
          const allNames = this.inner.getAllTools().map((t) => t.name);
          this.inner.setActiveToolsByName(expandToolSelection(toolNames, allNames) as string[]);
        }
        this.setToolSelection(toolNames);
        // Mirror to the sidecar so the selection survives a server restart.
        // Best-effort: a failed write must not fail the tool switch.
        if (!writeSessionToolSelection(this.sessionId, toolNames)) {
          log.warn("failed to persist session tool selection", { sessionId: this.sessionId });
        }
        return null;
      }

      case "permission_decision": {
        const toolCallId = command.toolCallId as string;
        const decision = command.decision as PermissionDecision;
        const resolved = this.resolvePermission(toolCallId, decision);
        return { resolved };
      }

      case "ask_user_questions_decision": {
        const toolCallId = command.toolCallId as string;
        const decision = command.decision as
          | AskUserQuestionsDecision
          | AskUserQuestionsCancel;
        const resolved = this.resolveUserInput(toolCallId, decision);
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
    for (const [, pending] of this.pendingPermissions) {
      clearTimeout(pending.timeoutHandle);
      pending.reject("destroyed");
    }
    this.pendingPermissions.clear();
    this.allowedThisSession.clear();
    for (const [, pending] of this.pendingUserInputs) {
      pending.reject("destroyed");
    }
    this.pendingUserInputs.clear();
    log.info("agent wrapper destroyed", {
      sessionId: this.sessionId,
      sessionFile: this.sessionFile || undefined,
    });
  }
}

/**
 * Extract the plain-text body of an assistant message, skipping thinking /
 * tool-call / image blocks. Returns "" when the message isn't an assistant
 * body reply (user, errored, no text). Used to build per-session reply
 * notifications.
 */
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

// ============================================================================
// Session registry
// ============================================================================
//
// The live-session map (`__piSessions`) plus `getRpcSession` /
// `listRunningRpcSessions` live in lib/server/session-registry.ts so the
// server-only self-management tools can read them without a circular import.
// They are re-exported here for backward compatibility with existing
// importers. `__piStartLocks` is only used internally by this module, so it
// stays local.

declare global {
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export { getRpcSession, listRunningRpcSessions } from "./session-registry";
export { runTurnRpcSession, type RunTurnRpcSpec } from "./turn/rpc-factory";

/** Remove generic Pi sections while preserving tool-generated tools/guidelines. */
function stripDefaultSystemPromptSections(prompt: string): string {
  return prompt
    .replace(
      /^You are an expert coding assistant operating inside pi, a coding agent harness\. You help users by reading files, executing commands, editing code, and writing new files\.\s*/,
      "",
    )
    .replace(
      /\nIn addition to the tools above, you may have access to other custom tools depending on the project\./,
      "",
    )
    .replace(
      /\n\nPi documentation \(read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI\):[\s\S]*?(?=\n\n<project_context>|\n\nCurrent working directory:|\nCurrent working directory:)/,
      "",
    )
    .trim();
}

/**
 * Remove ONLY pi's built-in "Pi documentation" section from a generated
 * system prompt, leaving everything else (append blocks, <project_context>,
 * skills, working directory, …) untouched. Unlike the lookahead-based regex
 * above, this anchors on the section's literal bullet lines, so it is safe
 * even when user content (e.g. APPEND_SYSTEM.md) sits right after the docs
 * block — it never over-consumes following sections.
 *
 * Backed by PiWorkConfig.load_pi_docs: when the toggle is off, new sessions
 * start without the model being pointed at the pi SDK README / docs paths.
 */
const PI_DOCUMENTATION_SECTION_RE =
  /\n\nPi documentation \(read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI\):\n- Main documentation: [^\n]+\n- Additional docs: [^\n]+\n- Examples: [^\n]+\n- When reading pi docs or examples, resolve docs\/\.\.\. under Additional docs and examples\/\.\.\. under Examples, not the current working directory\n- When asked about: [^\n]+\n- When working on pi topics, read the docs and examples, and follow \.md cross-references before implementing\n- Always read pi \.md files completely and follow links to related docs \(e\.g\., tui\.md for TUI API details\)/;

function stripPiDocumentationSection(prompt: string): string {
  return prompt.replace(PI_DOCUMENTATION_SECTION_RE, "").trimStart();
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled, "all" = every available tool).
 * Omit toolNames to auto-resolve: existing sessions restore their persisted
 * per-session selection (~/.pi-work/session-tools/, falling back to the cwd
 * default in ~/.pi-work/cwd-tools.json, then "all"); new sessions use the
 * cwd default, then "all". The resolved selection is mirrored to the
 * per-session sidecar so restarts are cache-stable.
 */
type RpcThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Subagent sessions are attached to no UI (their SSE stream is only read when
 * the child session is opened manually), so a permission prompt raised there
 * can only time out — dangerous_patterns.timeout_ms, 5 minutes by default —
 * and be auto-denied anyway. Refuse immediately with a reason the child can
 * act on. See docs/adr/0001-subagent-toolsets-must-not-need-a-permission-prompt.md.
 */
function subagentPermissionBlock(what: string) {
  return {
    block: true,
    reason: `Blocked: ${what} requires the user's confirmation, which is unavailable inside a subagent session. Don't retry it; use a read-only alternative and tell the user what you need.`,
  };
}

export interface StartRpcSessionOptions {
  /** Use a specific model for a newly-created session. */
  model?: { provider: string; modelId: string };
  /** Use a specific thinking level for a newly-created session. */
  thinkingLevel?: RpcThinkingLevel;
  /** Restrict the tool registry exposed to this session. */
  allowedToolNames?: string[];
  /** Prefix the generated system prompt for specialized sessions. */
  systemPromptPrefix?: string;
  /** Remove Pi's generic documentation / harness sections from the prompt. */
  stripDefaultSystemPromptSections?: boolean;
  /** Persist the parent session id in a newly-created session header. */
  parentSessionId?: string;
}

export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: ToolSelection,
  source: "user" | "scheduled" | "subagent" = "user",
  options: StartRpcSessionOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  // Resolve the effective tool selection before the IIFE so it is stable.
  // `undefined` means "caller did not specify": for an existing session file
  // (e.g. after a server restart) restore the selection persisted for this
  // session — falling back to the cwd default for legacy sessions, and to
  // "all" only when nothing is recorded. An explicit argument ("all" or an
  // array) is honored as-is. Without the restore, a restarted server would
  // re-open every old conversation with the full tool registry, changing the
  // system prompt and tool block and killing the prompt cache hit rate.
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

    // Install the LLM API audit fetch patch once per process, and share a
    // single wrapped ModelRuntime across all sessions so the audit context
    // (session/source) reaches every provider call and host allowlist stays
    // fresh. ModelRuntime is a stateless catalog/auth/stream layer, so reuse
    // across sessions is safe.
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

    // Inline extension that mirrors every outgoing provider request and
    // its response headers into our in-memory ring buffer. Each session
    // gets its own loader/closure, so `capturedSessionId` only ever holds
    // the id for this wrapper.
    let capturedSessionId: string | null = null;
    // Source of this session (user-driven tab vs scheduler-fired task).
    // Captured once at construction so token-audit rows can attribute cost.
    const capturedSource: "user" | "scheduled" | "subagent" = source;
    // Forward reference — the tool_call handler runs inside the agent's
    // extension context but needs to call back into the wrapper to surface
    // permission requests and resolve them. Set immediately after the
    // wrapper is constructed below. Using a box object so TypeScript does
    // not narrow the type to `never` inside the closure.
    const wrapperRef: { current: AgentSessionWrapper | null } = { current: null };
    // Same forward-reference pattern for the `ask_user_questions` tool:
    // the tool closure captures this ref and reads the wrapper at execute
    // time. Set immediately after the wrapper is constructed below.
    const requestUserInputRef: { current: AgentSessionWrapper | null } = { current: null };
    // Snapshot which agent-side custom tools are enabled for this session.
    // Read once here so the value is stable across the IIFE (an in-flight
    // config write shouldn't change the tool set mid-session). Custom
    // tools are passed to createAgentSession below — already-running
    // sessions keep their original set even if the user toggles a switch.
    const enabledTools = new Set(readEnabledTools());
    // APPEND_SYSTEM.md loader toggle (see PiWorkConfig.append_system): when the
    // user has disabled it, we hand DefaultResourceLoader an explicit empty
    // array so the `??` on `appendSystemPromptSource` short-circuits and
    // `discoverAppendSystemPromptFile()` never runs. Read once per session
    // start — toggling at runtime only affects sessions started afterward.
    let appendSystemPromptLoaderOption: string[] | undefined;
    let disabledSkillPaths = new Set<string>();
    // Whether pi's built-in "Pi documentation" section should be loaded into
    // this session's system prompt (PiWorkConfig.load_pi_docs). When off we
    // register a before_agent_start extension below that strips only that
    // block. Read once per session start, like the append toggle above.
    let loadPiDocs = true;
    try {
      const cfg = readConfig();
      disabledSkillPaths = new Set(cfg.disabled_skills[cwd] ?? []);
      loadPiDocs = cfg.load_pi_docs;
      // Specialized subagents intentionally do not inherit APPEND_SYSTEM.md.
      if (options.systemPromptPrefix || !cfg.append_system.enabled) {
        appendSystemPromptLoaderOption = [];
      }
    } catch {
      // readConfig already logs and falls back to defaults; this catch is defensive only.
    }
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      // Pass `[]` (not `undefined`) when the toggle is off — the loader's
      // `??` on appendSystemPromptSource treats an explicit empty array as
      // "user-supplied, nothing to append" and skips file discovery.
      // Leaving `undefined` here would fall through to discovery.
      ...(appendSystemPromptLoaderOption !== undefined
        ? { appendSystemPrompt: appendSystemPromptLoaderOption }
        : {}),
      // Builtin hardcoded append blocks contributed by enabled custom tools.
      // These flow through the same channel as user APPEND_SYSTEM.md entries
      // (joined with "\n\n" and appended at the very end of the system
      // prompt), but live in code instead of a configurable file. Gated here
      // once per session so a mid-session toggle doesn't change the prompt.
      appendSystemPromptOverride: (baseAppend) => {
        if (options.systemPromptPrefix) return [];
        // Whole-block system-prompt contributions from enabled custom /
        // tool-market tools. Gate each block on the tools-market enablement
        // AND the session's actual tool selection: if a tool is excluded
        // from this session (per-session tool picker, cwd default, or
        // allowedToolNames), its append block must not leak into the
        // system prompt.
        const sessionHasTool = (name: string): boolean =>
          enabledTools.has(name as ToolMarketId) &&
          (!options.allowedToolNames || options.allowedToolNames.includes(name)) &&
          (effectiveToolNames === "all" ||
            // The stored selection may carry trailing-`*` prefix patterns
            // (bound groups like "codegraph_*" from the tool picker, or named
            // presets like the Assistant's "pi_work_*"); expand them here,
            // matching expandToolSelection applied to the live registry below.
            effectiveToolNames.some((entry) =>
              entry === name || (entry.endsWith("*") && name.startsWith(entry.slice(0, -1))),
            ));
        const blocks: string[] = [];
        if (sessionHasTool("ask_user_questions")) blocks.push(ASK_USER_QUESTIONS_SYSTEM_PROMPT_BLOCK);
        if (sessionHasTool("spawn_subagent")) blocks.push(SPAWN_SUBAGENT_SYSTEM_PROMPT_BLOCK);
        if (sessionHasTool("show_media")) blocks.push(SHOW_MEDIA_SYSTEM_PROMPT_BLOCK);
        if (sessionHasTool("celebrate")) blocks.push(CELEBRATE_SYSTEM_PROMPT_BLOCK);
        if (sessionHasTool("web_search")) blocks.push(WEB_SEARCH_SYSTEM_PROMPT_BLOCK);
        if (sessionHasTool("fetch_content")) blocks.push(FETCH_CONTENT_SYSTEM_PROMPT_BLOCK);
        // CodeGraph tools are registered as a whole family when ANY codegraph
        // id is enabled (same condition as the customTools entry below). The
        // family shares ONE append block: its tools are bound together in the
        // UI (TOOL_GROUPS) and the guidance is only meaningful as a set, so
        // gate on the family being loaded AND at least one family tool being
        // active in this session (also covers legacy partial selections).
        const codegraphFamilyLoaded =
          options.allowedToolNames?.some((id) => CODEGRAPH_TOOL_IDS.includes(id as (typeof CODEGRAPH_TOOL_IDS)[number])) ||
          CODEGRAPH_TOOL_IDS.some((id) => enabledTools.has(id));
        if (codegraphFamilyLoaded && CODEGRAPH_TOOL_IDS.some((id) => sessionHasTool(id))) {
          blocks.push(CODEGRAPH_SYSTEM_PROMPT_BLOCK);
        }
        return blocks.length > 0 ? [...baseAppend, ...blocks] : baseAppend;
      },
      // Codebase explorers receive no Skills section. Other sessions retain
      // the existing per-cwd disabled-skill filtering behavior.
      noSkills: Boolean(options.systemPromptPrefix),
      skillsOverride: (base) => ({
        ...base,
        skills: options.systemPromptPrefix
          ? []
          : [
              ...base.skills.filter((skill) => !disabledSkillPaths.has(skill.filePath)),
              // Pi Work–owned skills (~/.pi-work/skills/) are not discovered by
              // pi's loader; merge them here so sessions can actually invoke
              // the same list the UI shows. Same per-cwd disable list applies.
              ...loadPiWorkSkillsSafety(),
            ].filter((skill) => !disabledSkillPaths.has(skill.filePath)),
      }),
      extensionFactories: [
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
        // PiWorkConfig.load_pi_docs toggle: when disabled, strip pi's built-in
        // "Pi documentation" section from freshly-generated system prompts for
        // normal (non-subagent) sessions. Prefix sessions are excluded — the
        // subagent path already handles section removal itself.
        ...(options.systemPromptPrefix || loadPiDocs
          ? []
          : [
              (pi: { on: (event: "before_agent_start", handler: (event: { systemPrompt: string }) => { systemPrompt: string }) => void }) => {
                pi.on("before_agent_start", (event) => {
                  // Always return the (possibly unchanged) prompt — the regex
                  // is a no-op pass-through when the block is already absent.
                  return { systemPrompt: stripPiDocumentationSection(event.systemPrompt) };
                });
              },
            ]),
        (pi) => {
          pi.on("tool_call", async (event) => {
            // CodeGraph index construction: mode=sync is lightweight and runs
            // freely, but mode=init/index are minutes-long full scans — treat
            // them like a dangerous command and require the user's explicit
            // approval (indexing is the user's decision, never the agent's).
            if (isToolCallEventType<"codegraph_build", { mode?: unknown }>("codegraph_build", event)) {
              const mode = typeof event.input?.mode === "string" ? event.input.mode : "sync";
              if (mode === "sync") return;
              const w = wrapperRef.current;
              if (!w) return;
              if (w.isRuleAllowedThisSession(`codegraph_${mode}`)) return;
              if (capturedSource === "subagent") {
                return subagentPermissionBlock(`codegraph_build mode=${mode}`);
              }
              const command =
                mode === "init"
                  ? `codegraph init ${event.input?.path ?? "<cwd>"}`
                  : `codegraph index ${event.input?.path ?? "<cwd>"}`;
              const decision = await w.requestPermission(event.toolCallId, `codegraph_${mode}`, command);
              if (decision === "deny") {
                return { block: true, reason: `Denied by user: ${mode === "init" ? "index creation" : "index rebuild"}` };
              }
              return undefined;
            }

            if (!isToolCallEventType("bash", event)) return;
            const command = event.input.command;
            // Self-protection (hard, code-level): commands that would kill
            // this very server are blocked unconditionally — no permission
            // prompt, no per-session allowance, not user-configurable.
            const selfKill = matchSelfKillCommand(command);
            if (selfKill) {
              log.warn("self-protection blocked bash command", { command, reason: selfKill.reason });
              return {
                block: true,
                reason: "The bash command was blocked. Don't try it again and tell the user what you want to do.",
              };
            }
            const match = matchDangerousPattern(command);
            if (!match) return;
            const w = wrapperRef.current;
            if (!w) return;
            if (w.isRuleAllowedThisSession(match.ruleName)) return;
            if (capturedSource === "subagent") {
              return subagentPermissionBlock(`the dangerous-command rule "${match.ruleName}"`);
            }
            const decision = await w.requestPermission(event.toolCallId, match.ruleName, command);
            if (decision === "deny") {
              return { block: true, reason: "Denied by user" };
            }
            // 'allow_once' and 'allow_similar' both let the tool run.
            // 'allow_similar' was already recorded on the wrapper.
            return undefined;
          });
        },
        // ── Token audit capture ──────────────────────────────────────────
        // One row per assistant `message_end`. Uses `INSERT OR IGNORE` against
        // UNIQUE(session_id, message_id) so retries / SSE reconnects / compaction
        // replays never inflate the audit log.
        //
        // duration_ms = (Date.now() at hook time) − msg.timestamp. `msg.timestamp`
        // is when the LLM finalized the message internally; `Date.now()` is when
        // our hook fires immediately after — gap is just RPC event dispatch
        // (~few ms), so this is a tight upper bound on real call latency.
        //
        // We deliberately do NOT use `before_provider_request` for the start
        // stamp: in observed runs, that event can fire *after* `msg.timestamp`
        // by a few ms (likely pi-internal preflight + a second dispatch), which
        // produces negative durations after clamping. Computing duration from
        // `msg.timestamp` + hook time is strictly non-negative and accurate.
        (pi) => {
          pi.on("message_end", (event) => {
            const ev = event as { message?: { role?: string; provider?: string; model?: string; api?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number } }; timestamp?: number; stopReason?: string; errorMessage?: string } };
            const msg = ev.message;
            if (!msg || msg.role !== "assistant") return;
            if (!capturedSessionId) return;
            // AssistantMessage has no `id` field on the in-memory object — the
            // JSONL entry id is on the OUTER entry, not available to extensions.
            // Use `timestamp` (ms) as the dedup key; collisions only occur on
            // SDK replays (compaction, SSE reconnect), which is what we want to
            // dedupe via the UNIQUE(session_id, message_id) constraint.
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
                // Store `finalizedAt` as `ts` for sorting/filtering. It is the
                // moment the LLM produced its final message — close enough to
                // "when this call happened" for human-scale audit purposes.
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
      // Per-session customTools: gated by ~/.pi-work/config.yaml →
      // custom_tools.enabled. Read at startRpcSession
      // time only — already-running sessions keep their original tool set.
      // `show_file` is accepted as a legacy alias of `show_media` so users
      // with an existing config.yaml entry don't lose access after the
      // rename.
      customTools: [
        // Override the SDK built-in bash definition. Its hook runs after
        // session PI_* variables are injected and does not mutate process.env.
        createPiWorkBashTool(cwd),
        ...(enabledTools.has("show_media")
          ? buildShowFileTool()
          : []),
        ...(readConfig().web_access.enabled && (enabledTools.has("web_search") || enabledTools.has("fetch_content"))
          ? buildWebAccessTools().filter((tool) => enabledTools.has(tool.name as ToolMarketId))
          : []),
        // Core orchestration tool. It is controlled by the tool market for
        // normal sessions; child profiles exclude it through allowedToolNames,
        // so subagents cannot recursively spawn more subagents in the MVP.
        ...(enabledTools.has("spawn_subagent") ? [spawnSubagentTool] : []),
        ...(enabledTools.has("ask_user_questions")
          ? buildAskUserQuestionsTool({
              // Read the wrapper lazily at execute time. By the time the
              // agent can invoke the tool, the wrapper exists and the slot
              // is filled (see below). If the slot is somehow still null
              // (defensive), the tool returns an error result.
              requestUserInput: (toolCallId, questions) => {
                const w = requestUserInputRef.current;
                if (!w) {
                  return Promise.reject(
                    new Error("ask_user_questions wrapper not initialized"),
                  );
                }
                return w.requestUserInput(toolCallId, questions);
              },
              source: capturedSource,
            })
          : []),
        ...(enabledTools.has("celebrate") ? [celebrateTool] : []),
        // Pi Work platform dispatcher: read-only visibility into Pi Work's
        // own live sessions + disk-backed session details, consolidated into
        // one tool (pi_work_call) to keep tool descriptions out of the
        // system prompt. Gated via TOOL_MARKET_IDS.
        ...(enabledTools.has("pi_work_call") ? [piWorkCallTool] : []),
        // CodeGraph semantic code-intelligence tools: drive the CodeGraph SDK's
        // MCP ToolHandler in-process (see lib/server/codegraph-tool.ts). All
        // eight are gated by the same ~/.pi-work/tools-market.json entry list;
        // enabling any one registers the whole family (they share the SDK pool).
        ...((options.allowedToolNames?.some((id) => CODEGRAPH_TOOL_IDS.includes(id as typeof CODEGRAPH_TOOL_IDS[number])) || CODEGRAPH_TOOL_IDS.some((id) => enabledTools.has(id)))
          ? buildCodeGraphTools()
          : []),
      ],
      // The SDK's public option is `tools`; it becomes the hard allowlist
      // passed to AgentSession.allowedToolNames. This is intentionally used
      // for specialized sessions rather than relying only on active tools.
      ...(options.allowedToolNames ? { tools: options.allowedToolNames } : {}),
    });
    capturedSessionId = inner.sessionId as string;

    // Drop the cached /api/sessions list so the sidebar sees this new session
    // on its next refresh. Only needed when we actually created a new file —
    // re-opening an existing one doesn't change the set of sessions.
    if (isNewSession) {
      invalidateSessionListCache();
    }

    // Keep pi's full tool registry available so later switches to "all" can include
    // extension/custom tools, then set the active subset before the first prompt.
    // If "all" was requested, activate everything pi registered at runtime.
    if (effectiveToolNames === "all") {
      inner.setActiveToolsByName(inner.getAllTools().map((t: ToolInfo) => t.name));
    } else if (Array.isArray(effectiveToolNames)) {
      // Resolve trailing-`*` prefix patterns (e.g. "pi_work_*") against the
      // registry pi built for this session before applying.
      const expanded = expandToolSelection(
        effectiveToolNames,
        inner.getAllTools().map((t: ToolInfo) => t.name),
      ) as string[];
      inner.setActiveToolsByName(expanded);

      // When all tools are disabled, clear the system prompt entirely.
      // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
      // the only way to truly clear it is to call agent.setSystemPrompt directly.
      if (expanded.length === 0) {
        inner.agent.state.systemPrompt = "";
      }
    }

    const wrapper = new AgentSessionWrapper(inner, source, cwd);
    // Remember the raw selection this session started with so `get_state` can
    // report it (restored-from-sidecar selection included) — the UI labels the
    // tools button from it.
    wrapper.setToolSelection(effectiveToolNames);
    wrapperRef.current = wrapper;
    requestUserInputRef.current = wrapper;
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);
    // Mirror the live selection to the sidecar so a server restart can
    // restore exactly this set when re-opening the session (per-session
    // selection has no home inside pi's session JSONL).
    writeSessionToolSelection(realSessionId, effectiveToolNames);

    wrapper.onDestroy(() => {
      registry.delete(realSessionId);
      // Note: payload capture file is intentionally NOT cleared here.
      // It survives session unload and is only removed when the session
      // itself is deleted (see app/api/sessions/[id]/route.ts DELETE).
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
