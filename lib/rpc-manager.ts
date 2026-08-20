import { createAgentSession, DefaultResourceLoader, isToolCallEventType, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { cacheSessionPath, invalidateSessionListCache, stripSessionInfoNodes, fallbackSessionLeafId } from "./session-reader";
import type { AgentSessionLike, ToolInfo } from "./pi-types";
import type { ToolSelection } from "./types";
import { createLogger, elapsedMs } from "./logger";
import { readConfig } from "./config";
import path from "node:path";

import { recordCall } from "./token-audit-store";
import { getAuditModelRuntime, installLlmFetchAudit, runWithLlmAuditContext } from "./llm-audit";
import type { LlmAuditSource } from "./llm-audit-types";
import { buildTodoTools } from "./user-todo/tools";
import { readEnabledTodoTools } from "./user-todo/tools-config";
import { buildShowFileTool } from "./show-file-tool";
import { buildAgentTodoTool } from "./agent-todo-tool";
import { buildAskUserQuestionsTool, type UserInputResolution } from "./ask-user-questions-tool";
import type { AskUserQuestion, AskUserQuestionsCancel, AskUserQuestionsDecision, AskUserQuestionsRequestPayload } from "./ask-user-questions-tool-types";
import { readEnabledCustomTools } from "./custom-tools-config";
import { matchDangerousPattern, getDangerousPatternTimeoutMs } from "./dangerous-patterns";

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

  isAlive(): boolean {
    return this._alive;
  }

  /** True while the agent is between agent_start and agent_end (or compacting). */
  isRunning(): boolean {
    return this._running || this.compactInFlight || this.inner.isStreaming || this.inner.isCompacting;
  }

  start(): void {
    log.info("agent wrapper started", {
      sessionId: this.sessionId,
      sessionFile: this.sessionFile || undefined,
    });
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.resetIdleTimer();
      this.updateRunningState(event);
      // Push the freshest conversation tree after every persisted message
      // (message_end is when pi writes the entry to the session file), so
      // the conversation-tree panel can render new cards without waiting
      // for the whole turn to finish (agent_end → full session reload).
      if (event.type === "message_end") {
        this.emitTreeUpdate();
      }
      for (const l of this.listeners) l(event);
    });
    this.resetIdleTimer();
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

  private updateRunningState(event: AgentEvent): void {
    switch (event.type) {
      case "agent_start":
      case "compaction_start":
      case "auto_compaction_start":
        this._running = true;
        break;
      case "agent_end":
      case "compaction_end":
      case "auto_compaction_end":
        this._running = false;
        break;
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.destroy(), 10 * 60 * 1000);
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
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
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
          this.inner.setActiveToolsByName(toolNames);
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

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

/**
 * Snapshot of which registered sessions are currently running.
 * Reads `globalThis.__piSessions` only — no disk I/O — so callers can poll
 * this cheaply (the SessionSidebar uses it every 3s to render a spinner on
 * the active row).
 */
export function listRunningRpcSessions(): { id: string; running: boolean }[] {
  const out: { id: string; running: boolean }[] = [];
  for (const [id, wrapper] of getRegistry()) {
    out.push({ id, running: wrapper.isRunning() });
  }
  return out;
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled, "all" = every available tool).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames: ToolSelection = "all",
  source: "user" | "scheduled" = "user"
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
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
      requestedToolCount: toolNames === "all" ? "all" : toolNames?.length,
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

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, undefined);
    const isNewSession = !sessionFile;

    // Inline extension that mirrors every outgoing provider request and
    // its response headers into our in-memory ring buffer. Each session
    // gets its own loader/closure, so `capturedSessionId` only ever holds
    // the id for this wrapper.
    let capturedSessionId: string | null = null;
    // Source of this session (user-driven tab vs scheduler-fired task).
    // Captured once at construction so token-audit rows can attribute cost.
    const capturedSource: "user" | "scheduled" = source;
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
    const enabledCustom = readEnabledCustomTools();
    // APPEND_SYSTEM.md loader toggle (see PiWorkConfig.append_system): when the
    // user has disabled it, we hand DefaultResourceLoader an explicit empty
    // array so the `??` on `appendSystemPromptSource` short-circuits and
    // `discoverAppendSystemPromptFile()` never runs. Read once per session
    // start — toggling at runtime only affects sessions started afterward.
    let appendSystemPromptLoaderOption: string[] | undefined;
    try {
      const cfg = readConfig();
      if (!cfg.append_system.enabled) {
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
      extensionFactories: [
        (pi) => {
          pi.on("tool_call", async (event) => {
            if (!isToolCallEventType("bash", event)) return;
            const command = event.input.command;
            const match = matchDangerousPattern(command);
            if (!match) return;
            const w = wrapperRef.current;
            if (!w) return;
            if (w.isRuleAllowedThisSession(match.ruleName)) return;
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
      // Per-session customTools: user_todos_list / user_todo_description are
      // gated by ~/.pi-work/todo-tools.json (see todo-tools-config); the two
      // agent-side tools (show_media, agent_todo) are gated by
      // ~/.pi-work/config.yaml → custom_tools.enabled. Read at startRpcSession
      // time only — already-running sessions keep their original tool set.
      // `show_file` is accepted as a legacy alias of `show_media` so users
      // with an existing config.yaml entry don't lose access after the
      // rename.
      customTools: [
        ...buildTodoTools(readEnabledTodoTools()),
        ...(enabledCustom.has("show_media") || enabledCustom.has("show_file")
          ? buildShowFileTool()
          : []),
        ...(enabledCustom.has("agent_todo") ? buildAgentTodoTool() : []),
        ...(enabledCustom.has("ask_user_questions")
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
      ],
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
    if (toolNames === "all") {
      inner.setActiveToolsByName(inner.getAllTools().map((t: ToolInfo) => t.name));
    } else if (Array.isArray(toolNames)) {
      inner.setActiveToolsByName(toolNames);
    }

    // When all tools are disabled, clear the system prompt entirely.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // the only way to truly clear it is to call agent.setSystemPrompt directly.
    if (Array.isArray(toolNames) && toolNames.length === 0) {
      inner.agent.state.systemPrompt = "";
    }

    const wrapper = new AgentSessionWrapper(inner, source, cwd);
    wrapperRef.current = wrapper;
    requestUserInputRef.current = wrapper;
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

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
