import type { AskUserQuestion, AskUserQuestionsRequestPayload } from "./ask-user-questions-tool-types";
import type { MessageOrigin } from "./message-origin";
import { LEGACY_SPAWN_SUBAGENT_TOOL_NAME, SUBAGENT_TOOL_NAME } from "./subagent";
import { CELEBRATE_TOOL_NAME, type CelebrateDetails } from "./celebrate-tool-types";
import type { UiSoundEventId } from "./config-types";
import { normalizeToolCalls } from "./normalize";
import { extractMessageText } from "./message-content";
import { parseSkillBlock, parseSkillCommand } from "./skill-block";
import {
  mergeInFlightToolPartialResult,
  patchSessionRuntimeState,
  removeInFlightTool,
  upsertInFlightTool,
  type AgentPhase,
  type ContextUsage,
  type SessionRuntimeState,
  type SessionSnapshotPayload,
} from "./session-runtime-state";
import type { AgentMessage, AssistantMessage, SessionTreeNode, ToolSelection } from "./types";
import type { ContextComposition } from "./context-composition";
import { isSessionPermissionMode, type SessionPermissionMode } from "./permission-mode";

export type SessionCompactionReason = "manual" | "threshold" | "overflow";

export interface SessionEventMessage {
  role?: string;
  content?: unknown;
  stopReason?: string;
  errorMessage?: string;
  timestamp?: number;
}

export type SessionEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: SessionEventMessage[]; willRetry: boolean }
  | { type: "turn_start" }
  | { type: "turn_end"; message: SessionEventMessage; toolResults: SessionEventMessage[] }
  | { type: "message_start"; message: SessionEventMessage }
  | {
      type: "message_update";
      message: SessionEventMessage;
      assistantMessageEvent?: unknown;
    }
  | {
      type: "message_end";
      message: SessionEventMessage;
      origin?: MessageOrigin;
    }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | { type: "agent_settled" }
  | { type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }
  | { type: "compaction_start"; reason: SessionCompactionReason }
  | {
      type: "compaction_end";
      reason: SessionCompactionReason;
      result: unknown;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | {
      type: "entry_appended";
      entry: unknown;
    }
  | { type: "session_info_changed"; name: string | undefined }
  | { type: "thinking_level_changed"; level: string }
  | {
      type: "permission_mode_changed";
      mode: SessionPermissionMode;
    }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
  | {
      type: "summarization_retry_scheduled";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | {
      type: "summarization_retry_attempt_start";
      source: "branchSummary" | "compaction";
      reason?: SessionCompactionReason;
    }
  | { type: "summarization_retry_finished" }
  | { type: "bash_execution_update"; id?: string; delta: string }
  | {
      type: "session_tree_update";
      tree: unknown;
      leafId: string | null;
    }
  | { type: "permission_request"; toolCallId: string; ruleName: string; command: string }
  | ({ type: "ask_user_questions_request" } & AskUserQuestionsRequestPayload)
  | { type: "prompt_failed"; error: string }
  | { type: "connected"; sessionId: string };

export type SessionEventType = SessionEvent["type"];

export type ReducedSessionEventType =
  | "agent_start"
  | "agent_end"
  | "message_start"
  | "message_update"
  | "message_end"
  | "session_tree_update"
  | "tool_execution_start"
  | "tool_execution_update"
  | "tool_execution_end"
  | "auto_retry_start"
  | "auto_retry_end"
  | "prompt_failed"
  | "permission_request"
  | "ask_user_questions_request"
  | "compaction_start"
  | "compaction_end"
  | "thinking_level_changed"
  | "permission_mode_changed";

export type IgnoredSessionEventType = Exclude<SessionEventType, ReducedSessionEventType>;

export const REDUCED_SESSION_EVENTS: Record<ReducedSessionEventType, string> = {
  agent_start: "Clears the runtime error, marks the session running, opens the streaming view.",
  agent_end: "Closes the low-level run: running flags off, pending model error surfaced.",
  message_start: "Opens the streaming view, and refreshes the subagent panel for a new subagent call.",
  message_update: "Feeds a streamed token snapshot into the streaming view.",
  message_end: "Commits the finished message, records a model error, requests a context-usage refresh.",
  session_tree_update: "Replaces the live conversation tree and the active leaf.",
  tool_execution_start: "Adds an in-flight tool call (name + args), reports it to the tool-call stats, and refreshes the subagent panel for a spawning call.",
  tool_execution_update: "Merges a partial tool result into the in-flight tool call.",
  tool_execution_end: "Retires the in-flight tool call; the args recorded at start decide git invalidation and the result drives the celebration, the file preview and the stats.",
  auto_retry_start: "Shows the auto-retry counter.",
  auto_retry_end: "Clears the retry counter, or surfaces the final error.",
  prompt_failed: "Closes the turn with an error and drops the event stream.",
  permission_request: "Hands the dangerous-command confirmation to the permission queue, once per tool call id, and rings.",
  ask_user_questions_request: "Opens the question card (once per tool call id) and rings.",
  compaction_start: "Marks the session as compacting.",
  compaction_end: "Leaves compaction, honouring the willRetry branch, and reloads the session.",
  thinking_level_changed: "Mirrors the model's thinking level.",
  permission_mode_changed:
    "Mirrors the session's permission mode — what drives the toolbar button, the input border, the badges and the palette entry.",
};

export const IGNORED_SESSION_EVENTS: Record<IgnoredSessionEventType, string> = {
  agent_settled:
    "The overall run settled. The client still ends the turn on agent_end (ADR-0004 wants this revisited); listed here so the difference is a decision, not an oversight.",
  turn_start: "Low-level turn boundary; no part of the UI keys off it.",
  turn_end: "Same boundary on the other side; per-turn tool results arrive through message_end.",
  entry_appended: "A session entry was persisted; the tree arrives via session_tree_update instead.",
  queue_update: "Steering / follow-up queue depths; the UI has no queue indicator yet.",
  session_info_changed: "Renames are mirrored to the sidecar server-side and read back through the session APIs.",
  summarization_retry_scheduled: "Compaction-retry telemetry; the banner follows compaction_start / compaction_end.",
  summarization_retry_attempt_start: "Same telemetry, attempt boundary.",
  summarization_retry_finished: "Same telemetry, finished.",
  bash_execution_update: "Streamed bash output; the terminal surface is its own WebSocket, not this stream.",
  connected: "The route's opening frame; the transport already knows which session it subscribed to.",
};

export const SESSION_EVENT_TYPES = [
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "agent_settled",
  "queue_update",
  "compaction_start",
  "compaction_end",
  "entry_appended",
  "session_info_changed",
  "thinking_level_changed",
  "permission_mode_changed",
  "auto_retry_start",
  "auto_retry_end",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
  "bash_execution_update",
  "session_tree_update",
  "permission_request",
  "ask_user_questions_request",
  "prompt_failed",
  "connected",
] as const satisfies readonly SessionEventType[];

type AssertTrue<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type SessionEventDispositionsAreComplete = AssertTrue<
  Equal<SessionEventType, ReducedSessionEventType | IgnoredSessionEventType>
>;

export type ReducedSessionEventsAreProtocolTypes = AssertTrue<
  ReducedSessionEventType extends SessionEventType ? true : false
>;

export type SessionEventTypesAreComplete = AssertTrue<
  Equal<SessionEventType, (typeof SESSION_EVENT_TYPES)[number]>
>;

export type ReducedSessionEvent = Extract<SessionEvent, { type: ReducedSessionEventType }>;

const REDUCED_SESSION_EVENT_TYPE_SET: ReadonlySet<string> = new Set(Object.keys(REDUCED_SESSION_EVENTS));

export function isReducedSessionEvent(event: SessionEvent): event is ReducedSessionEvent {
  return REDUCED_SESSION_EVENT_TYPE_SET.has(event.type);
}

export interface ClientSnapshotInput {
  type: "client_snapshot";
  snapshot: SessionSnapshotPayload | null;
}

export interface ClientContextUsageInput {
  type: "client_context_usage";
  contextUsage?: ContextUsage | null;
  contextComposition?: ContextComposition | null;
}

export type ClientSessionInput = ClientSnapshotInput | ClientContextUsageInput;

export type SessionRuntimeInput = SessionEvent | ClientSessionInput;

export const CLIENT_SESSION_INPUT_TYPES = [
  "client_snapshot",
  "client_context_usage",
] as const satisfies readonly ClientSessionInput["type"][];

export type ClientInputTypesAreComplete = AssertTrue<
  Equal<ClientSessionInput["type"], (typeof CLIENT_SESSION_INPUT_TYPES)[number]>
>;

export type ClientInputTypesAreDisjoint = AssertTrue<
  Extract<ClientSessionInput["type"], SessionEventType> extends never ? true : false
>;

const CLIENT_SESSION_INPUT_TYPE_SET: ReadonlySet<string> = new Set(CLIENT_SESSION_INPUT_TYPES);

export function isClientSessionInput(input: SessionRuntimeInput): input is ClientSessionInput {
  return CLIENT_SESSION_INPUT_TYPE_SET.has(input.type);
}

export type SessionEventEffect =
  | { kind: "enqueue_permission_request"; toolCallId: string; ruleName: string; command: string }
  | { kind: "set_pending_ask_user_questions"; request: AskUserQuestionsRequestPayload }
  | { kind: "play_ui_sound"; sound: UiSoundEventId }
  | { kind: "invalidate_git_status"; force: boolean }
  | { kind: "celebrate"; details: CelebrateDetails | undefined }
  | { kind: "refresh_subagent_panel"; toolCallId: string }
  | { kind: "flash_bot_state"; stateKey: string }
  | { kind: "stream_message"; message: AgentMessage }
  | { kind: "settle_stream"; message: AgentMessage | null; keepForError: boolean }
  | { kind: "refresh_context_usage" }
  | { kind: "first_assistant_ready" }
  | { kind: "record_assistant_outcome"; isBody: boolean; pendingError: string | null }
  | { kind: "begin_stream" }
  | { kind: "refresh_system_prompt" }
  | { kind: "set_bot_baseline" }
  | { kind: "show_error_toast"; message: string }
  | { kind: "show_compaction_error_toast"; message: string }
  | { kind: "reload_session_after_turn" }
  | { kind: "reload_session_after_compaction"; aborted: boolean }
  | { kind: "notify_agent_end" }
  | { kind: "close_events" }
  | { kind: "adopt_system_prompt"; value: string | null }
  | { kind: "adopt_tool_selection"; selection: ToolSelection }
  | { kind: "end_streaming_view" };

export interface SessionEventReduction {
  state: SessionRuntimeState;
  effects: SessionEventEffect[];
}

const WORKTREE_MUTATING_TOOL_NAMES = new Set(["edit", "write"]);

const TOOL_ERROR_BOT_STATE = "suspicious";

const FALLBACK_ASSISTANT_ERROR = "Model call failed";

const SUBAGENT_TOOL_NAMES = new Set([SUBAGENT_TOOL_NAME, LEGACY_SPAWN_SUBAGENT_TOOL_NAME]);

function subagentToolCallIdsOf(message: unknown): string[] {
  if (!message || typeof message !== "object") return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const value = block as { type?: unknown; toolName?: unknown; toolCallId?: unknown };
    return value.type === "toolCall"
      && typeof value.toolName === "string"
      && SUBAGENT_TOOL_NAMES.has(value.toolName)
      && typeof value.toolCallId === "string"
      ? [value.toolCallId]
      : [];
  });
}

function pushSubagentRefreshes(
  state: SessionRuntimeState,
  message: unknown,
  effects: SessionEventEffect[],
): void {
  for (const toolCallId of subagentToolCallIdsOf(message)) {
    if (state.seenSubagentToolCallIds.claim(toolCallId)) {
      effects.push({ kind: "refresh_subagent_panel", toolCallId });
    }
  }
}

function asArgumentRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sameCompletedMessage(a: AgentMessage, b: AgentMessage): boolean {
  if (a.role !== b.role) return false;
  if (a.role === "toolResult" && b.role === "toolResult" && a.toolCallId !== b.toolCallId) return false;
  const aTimestamp = "timestamp" in a ? a.timestamp : undefined;
  const bTimestamp = "timestamp" in b ? b.timestamp : undefined;
  if (aTimestamp !== undefined && bTimestamp !== undefined && aTimestamp !== bTimestamp) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function isBodyMessage(msg: AgentMessage): boolean {
  if (msg.role !== "assistant") return false;
  if ((msg as AssistantMessage).stopReason === "error") return false;
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) return false;
  let hasText = false;
  let hasToolUse = false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typedBlock = block as { type?: unknown; text?: unknown };
    if (typedBlock.type === "text" && typeof typedBlock.text === "string" && typedBlock.text.trim().length > 0) {
      hasText = true;
    }
    if (typedBlock.type === "toolUse") hasToolUse = true;
  }
  return hasText && !hasToolUse;
}

function bashCommandTouchesGit(args: unknown): boolean {
  if (!args || typeof args !== "object") return false;
  const command = (args as { command?: unknown }).command;
  if (typeof command !== "string" || command.length === 0) return false;
  return /\bgit\b/.test(command);
}

function textBlocksOf(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") texts.push(typed.text);
  }
  return texts;
}

function partialToolResultPatch(partial: unknown): { content?: { type: "text"; text: string }[]; details?: unknown } | null {
  if (!partial || typeof partial !== "object") return null;
  const value = partial as { content?: unknown; details?: unknown };
  const content = textBlocksOf(value.content).map((text) => ({ type: "text" as const, text }));
  if (content.length === 0 && value.details === undefined) return null;
  return {
    ...(content.length > 0 ? { content } : {}),
    ...(value.details !== undefined ? { details: value.details } : {}),
  };
}

function isValidAskUserQuestion(question: unknown): question is AskUserQuestion {
  if (!question || typeof question !== "object") return false;
  const value = question as Partial<AskUserQuestion>;
  return typeof value.question === "string"
    && typeof value.header === "string"
    && typeof value.multiSelect === "boolean"
    && typeof value.required === "boolean"
    && Array.isArray(value.options);
}

function closeTurn(state: SessionRuntimeState): SessionRuntimeState {
  let next = patchSessionRuntimeState(state, "agentRunning", false);
  next = patchSessionRuntimeState(next, "isCompacting", false);
  next = patchSessionRuntimeState(next, "agentPhase", null);
  return patchSessionRuntimeState(next, "retryInfo", null);
}

export function derivePendingToolCalls(
  messages: readonly AgentMessage[],
): { id: string; name: string; args?: Record<string, unknown> }[] {
  const lastUserIdx = messages.findLastIndex((message) => message.role === "user");
  if (lastUserIdx === -1) return [];
  const pending: { id: string; name: string; args?: Record<string, unknown> }[] = [];
  for (let i = lastUserIdx; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "toolCall") {
          pending.push({ id: block.toolCallId, name: block.toolName, args: block.input });
        }
      }
    } else if (message.role === "toolResult") {
      const idx = pending.findIndex((tool) => tool.id === message.toolCallId);
      if (idx !== -1) pending.splice(idx, 1);
    }
  }
  return pending;
}

function sameAgentPhase(a: AgentPhase, b: AgentPhase): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind !== "running_tools" || b.kind !== "running_tools") return true;
  if (a.tools.length !== b.tools.length) return false;
  return a.tools.every((tool, i) => {
    const other = b.tools[i];
    return tool.id === other.id && tool.name === other.name && tool.args === other.args;
  });
}

export function reduceSessionInput(
  state: SessionRuntimeState,
  input: SessionRuntimeInput,
): SessionEventReduction {
  if (isClientSessionInput(input)) return reduceClientSessionInput(state, input);
  return reduceSessionEvent(state, input);
}

function reduceClientSessionInput(
  state: SessionRuntimeState,
  input: ClientSessionInput,
): SessionEventReduction {
  switch (input.type) {
    case "client_snapshot": {
      const snapshot = input.snapshot;
      const live = snapshot?.state;
      let next = state;
      if (live?.contextUsage !== undefined) {
        next = patchSessionRuntimeState(next, "contextUsage", live.contextUsage ?? null);
      }
      if (live?.contextComposition !== undefined) {
        next = patchSessionRuntimeState(next, "contextComposition", live.contextComposition ?? null);
      }
      if (isSessionPermissionMode(live?.permissionMode)) {
        next = patchSessionRuntimeState(next, "permissionMode", live.permissionMode);
      }
      if (typeof live?.background === "boolean") {
        next = patchSessionRuntimeState(next, "isBackgroundSession", live.background);
      }
      const effects: SessionEventEffect[] = [];
      if (live?.systemPrompt !== undefined) {
        effects.push({ kind: "adopt_system_prompt", value: live.systemPrompt ?? null });
      }
      if (live?.toolNames !== undefined) {
        effects.push({ kind: "adopt_tool_selection", selection: live.toolNames });
      }

      const compacting = live?.isCompacting === true || live?.phase === "compacting";
      const running = Boolean(
        compacting ||
        live?.isRunning === true ||
        live?.isStreaming === true ||
        (snapshot?.running === true && !live),
      );

      const hint = running && !compacting ? derivePendingToolCalls(next.messages) : [];
      const phase: AgentPhase = compacting
        ? { kind: "compacting" }
        : running
          ? (hint.length > 0 ? { kind: "running_tools", tools: hint } : { kind: "waiting_model" })
          : null;
      next = patchSessionRuntimeState(next, "agentRunning", running);
      next = patchSessionRuntimeState(next, "isCompacting", compacting);
      next = patchSessionRuntimeState(next, "agentPhase", (previous) =>
        sameAgentPhase(previous, phase) ? previous : phase);
      if (!running) effects.push({ kind: "end_streaming_view" });
      return { state: next, effects };
    }
    case "client_context_usage": {
      let next = state;
      if (input.contextUsage !== undefined) {
        next = patchSessionRuntimeState(next, "contextUsage", input.contextUsage ?? null);
      }
      if (input.contextComposition !== undefined) {
        next = patchSessionRuntimeState(next, "contextComposition", input.contextComposition ?? null);
      }
      return { state: next, effects: [] };
    }
  }
}

export function reduceSessionEvent(
  state: SessionRuntimeState,
  event: SessionEvent,
): SessionEventReduction {
  if (!isReducedSessionEvent(event)) {
    return { state, effects: [] };
  }
  return reduceReducedSessionEvent(state, event);
}

function reduceReducedSessionEvent(
  state: SessionRuntimeState,
  event: ReducedSessionEvent,
): SessionEventReduction {
  switch (event.type) {
    case "permission_request": {
      if (!state.seenPermissionRequestToolCallIds.claim(event.toolCallId)) {
        return { state, effects: [] };
      }
      return {
        state,
        effects: [
          {
            kind: "enqueue_permission_request",
            toolCallId: event.toolCallId,
            ruleName: event.ruleName,
            command: event.command,
          },
          { kind: "play_ui_sound", sound: "permission_request" },
        ],
      };
    }
    case "tool_execution_start": {
      const { toolCallId, toolName, args } = event;
      const argsRecord = asArgumentRecord(args);
      let next = patchSessionRuntimeState(state, "inFlightTools", (previous) =>
        upsertInFlightTool(previous, toolCallId, toolName, args));
      next = patchSessionRuntimeState(next, "agentPhase", (previous) => {
        const tools = previous?.kind === "running_tools" ? [...previous.tools] : [];
        if (!tools.some((tool) => tool.id === toolCallId)) {
          tools.push({ id: toolCallId, name: toolName, args: argsRecord });
        }
        return { kind: "running_tools", tools };
      });
      const effects: SessionEventEffect[] = [];
      if (toolName && SUBAGENT_TOOL_NAMES.has(toolName) && state.seenSubagentToolStartIds.claim(toolCallId)) {
        effects.push({ kind: "refresh_subagent_panel", toolCallId });
      }
      return { state: next, effects };
    }
    case "tool_execution_update": {
      const patch = partialToolResultPatch(event.partialResult);
      if (!patch) return { state, effects: [] };
      const inFlightTools = mergeInFlightToolPartialResult(state.inFlightTools, event.toolCallId, patch);
      if (!inFlightTools) return { state, effects: [] };
      return {
        state: patchSessionRuntimeState(state, "inFlightTools", inFlightTools),
        effects: [],
      };
    }
    case "tool_execution_end": {
      const { toolCallId, result } = event;
      const isError = event.isError === true;
      const resultParts = result && typeof result === "object"
        ? result as { content?: unknown; details?: unknown }
        : undefined;
      const inFlight = state.inFlightTools.get(toolCallId);
      const toolName = inFlight?.name ?? event.toolName;
      const effects: SessionEventEffect[] = [];
      if (isError) effects.push({ kind: "flash_bot_state", stateKey: TOOL_ERROR_BOT_STATE });
      if (toolName && SUBAGENT_TOOL_NAMES.has(toolName) && state.seenSubagentToolEndIds.claim(toolCallId)) {
        effects.push({ kind: "refresh_subagent_panel", toolCallId });
      }
      if (toolName && WORKTREE_MUTATING_TOOL_NAMES.has(toolName)) {
        effects.push({ kind: "invalidate_git_status", force: false });
      }
      if (toolName === "bash" && bashCommandTouchesGit(inFlight?.args)) {
        effects.push({ kind: "invalidate_git_status", force: true });
      }
      if (toolName === CELEBRATE_TOOL_NAME && state.seenCelebrateToolEndIds.claim(toolCallId)) {
        effects.push({ kind: "celebrate", details: resultParts?.details as CelebrateDetails | undefined });
      }
      let next = patchSessionRuntimeState(state, "inFlightTools", (previous) =>
        removeInFlightTool(previous, toolCallId));
      next = patchSessionRuntimeState(next, "agentPhase", (previous) => {
        if (previous?.kind !== "running_tools") return previous;
        const tools = previous.tools.filter((tool) => tool.id !== toolCallId);
        return tools.length === 0 ? { kind: "waiting_model" } : { kind: "running_tools", tools };
      });
      return { state: next, effects };
    }
    case "ask_user_questions_request": {
      const questions = Array.isArray(event.questions)
        ? event.questions.filter(isValidAskUserQuestion)
        : [];
      if (typeof event.toolCallId !== "string" || questions.length === 0) {
        return { state, effects: [] };
      }
      if (!state.seenAskUserQuestionsToolCallIds.claim(event.toolCallId)) {
        return { state, effects: [] };
      }
      const request: AskUserQuestionsRequestPayload = {
        toolCallId: event.toolCallId,
        questions,
        ts: event.ts,
      };
      return {
        state,
        effects: [
          { kind: "set_pending_ask_user_questions", request },
          { kind: "play_ui_sound", sound: "ask_user_questions" },
        ],
      };
    }
    case "message_start":
    case "message_update": {
      const message = event.message as AgentMessage | undefined;
      const effects: SessionEventEffect[] = [];
      pushSubagentRefreshes(state, message, effects);
      if (message && message.role !== "user") {
        effects.push({ kind: "stream_message", message: normalizeToolCalls(message) });
      }
      return { state: patchSessionRuntimeState(state, "agentPhase", null), effects };
    }
    case "message_end": {
      const completed = event.message as AgentMessage | undefined;
      const isAssistant = completed?.role === "assistant";
      const effects: SessionEventEffect[] = [];
      pushSubagentRefreshes(state, completed, effects);
      let next = state;
      let settled: AgentMessage | null = null;
      if (completed && completed.role !== "user") {
        const normalized = normalizeToolCalls(completed);
        settled = normalized;
        next = patchSessionRuntimeState(next, "messages", (previous) =>
          previous.some((existing) => sameCompletedMessage(existing, normalized))
            ? previous
            : [...previous, normalized]);
      }
      if (completed?.role === "user") {
        const skillBlock = parseSkillBlock(extractMessageText(completed));
        next = patchSessionRuntimeState(next, "messages", (previous) => {
          const idx = previous.findLastIndex((m) => m.role === "user");
          if (idx === -1) return previous;
          const existing = previous[idx];
          if (existing.role !== "user") return previous;
          const command = skillBlock ? parseSkillCommand(extractMessageText(existing)) : null;
          const replaceContent = command && skillBlock
            && command.name === skillBlock.name
            && command.userMessage === skillBlock.userMessage;
          const mergeOrigin = event.origin && existing.origin === undefined;
          if (!replaceContent && !mergeOrigin) return previous;
          const merged = {
            ...existing,
            ...(replaceContent ? { content: completed.content } : {}),
            ...(mergeOrigin ? { origin: event.origin } : {}),
          };
          return [...previous.slice(0, idx), merged, ...previous.slice(idx + 1)];
        });
      }
      if (isAssistant && state.awaitingFirstAssistant) {
        next = patchSessionRuntimeState(next, "awaitingFirstAssistant", false);
        effects.push({ kind: "first_assistant_ready" });
      }
      const keepForError = isAssistant && completed?.stopReason === "error";
      effects.push({ kind: "settle_stream", message: settled, keepForError });
      if (completed && isAssistant) {
        effects.push({
          kind: "record_assistant_outcome",
          isBody: isBodyMessage(completed),
          pendingError: keepForError ? (completed.errorMessage ?? FALLBACK_ASSISTANT_ERROR) : null,
        });
        effects.push({ kind: "refresh_context_usage" });
      }
      next = patchSessionRuntimeState(next, "agentPhase", { kind: "waiting_model" });
      return { state: next, effects };
    }
    case "session_tree_update": {
      let next = state;
      if (Array.isArray(event.tree)) {
        next = patchSessionRuntimeState(next, "liveTree", event.tree as SessionTreeNode[]);
      }
      if (typeof event.leafId === "string") {
        next = patchSessionRuntimeState(next, "activeLeafId", event.leafId);
      }
      return { state: next, effects: [] };
    }
    case "agent_start": {
      let next = patchSessionRuntimeState(state, "runtimeError", null);
      next = patchSessionRuntimeState(next, "agentRunning", true);
      next = patchSessionRuntimeState(next, "isCompacting", false);
      next = patchSessionRuntimeState(next, "agentPhase", { kind: "waiting_model" });
      next = patchSessionRuntimeState(next, "lastAssistantIsBody", false);
      return {
        state: next,
        effects: [
          { kind: "begin_stream" },
          { kind: "refresh_system_prompt" },
          { kind: "set_bot_baseline" },
        ],
      };
    }
    case "agent_end": {
      const pendingError = state.pendingAssistantError;
      const hadAssistantError = pendingError !== null;
      const isBody = state.lastAssistantIsBody;
      let next = closeTurn(state);
      const effects: SessionEventEffect[] = [
        { kind: "settle_stream", message: null, keepForError: hadAssistantError },
      ];
      if (pendingError) {
        next = patchSessionRuntimeState(next, "runtimeError", pendingError);
        next = patchSessionRuntimeState(next, "pendingAssistantError", null);
        effects.push({ kind: "show_error_toast", message: pendingError });
      }
      if (hadAssistantError) effects.push({ kind: "play_ui_sound", sound: "agent_failure" });
      else if (isBody) effects.push({ kind: "play_ui_sound", sound: "agent_success" });
      effects.push({ kind: "flash_bot_state", stateKey: isBody ? "happy" : "waking" });
      effects.push({ kind: "reload_session_after_turn" });
      effects.push({ kind: "notify_agent_end" });
      return { state: next, effects };
    }
    case "auto_retry_start":
      return {
        state: patchSessionRuntimeState(state, "retryInfo", {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          errorMessage: event.errorMessage,
        }),
        effects: [],
      };
    case "auto_retry_end": {
      let next = patchSessionRuntimeState(state, "retryInfo", null);
      const effects: SessionEventEffect[] = [];
      if (event.success === false) {
        const finalError = event.finalError;
        if (finalError) {
          next = patchSessionRuntimeState(next, "runtimeError", finalError);
          next = patchSessionRuntimeState(next, "pendingAssistantError", null);
          effects.push({ kind: "show_error_toast", message: finalError });
          effects.push({ kind: "play_ui_sound", sound: "agent_failure" });
        }
      }
      return { state: next, effects };
    }
    case "prompt_failed": {
      const next = patchSessionRuntimeState(closeTurn(state), "runtimeError", event.error);
      return {
        state: next,
        effects: [
          { kind: "settle_stream", message: null, keepForError: false },
          { kind: "show_error_toast", message: event.error },
          { kind: "close_events" },
        ],
      };
    }
    case "compaction_start": {
      let next = patchSessionRuntimeState(state, "agentRunning", true);
      next = patchSessionRuntimeState(next, "isCompacting", true);
      next = patchSessionRuntimeState(next, "agentPhase", { kind: "compacting" });
      return { state: next, effects: [] };
    }
    case "compaction_end": {
      const willRetry = event.willRetry === true;
      let next = patchSessionRuntimeState(state, "isCompacting", false);
      const effects: SessionEventEffect[] = [];
      if (willRetry) {
        next = patchSessionRuntimeState(next, "agentRunning", true);
        next = patchSessionRuntimeState(next, "agentPhase", { kind: "waiting_model" });
      } else {
        next = patchSessionRuntimeState(next, "agentRunning", false);
        next = patchSessionRuntimeState(next, "agentPhase", null);
        effects.push({ kind: "settle_stream", message: null, keepForError: false });
      }
      if (event.errorMessage) {
        effects.push({ kind: "show_compaction_error_toast", message: event.errorMessage });
      }
      if (!willRetry) {
        effects.push({ kind: "reload_session_after_compaction", aborted: event.aborted });
      }
      return { state: next, effects };
    }
    case "thinking_level_changed":
      return {
        state: patchSessionRuntimeState(
          state,
          "thinkingLevel",
          event.level as SessionRuntimeState["thinkingLevel"],
        ),
        effects: [],
      };
    case "permission_mode_changed":
      return isSessionPermissionMode(event.mode)
        ? { state: patchSessionRuntimeState(state, "permissionMode", event.mode), effects: [] }
        : { state, effects: [] };
  }
}
