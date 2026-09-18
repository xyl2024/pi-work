import { useCallback, useRef, type Dispatch } from "react";
import type { AgentMessage, SessionInfo, SessionTreeNode, TextContent, ToolResultMessage } from "@/lib/shared/types";
import { normalizeToolCalls } from "@/lib/shared/normalize";
import type { ContextComposition } from "@/lib/shared/context-composition";
import {
  removeInFlightTool,
  upsertInFlightTool,
  type SessionRuntimeState,
  type StateUpdater,
} from "@/lib/shared/session-runtime-state";
import type { ToolCallStatsDispatch } from "../ToolCallStatsContext";
import { isShowFileToolName } from "@/lib/shared/show-file-tool-types";
import { CELEBRATE_TOOL_NAME, type CelebrateDetails } from "@/lib/shared/celebrate-tool-types";
import { triggerCelebration } from "@/lib/client/celebrate-store";
import { notifyMutated } from "@/lib/client/git-status-store";
import { playUiSoundEvent } from "@/lib/client/ui-sounds";
import { setGrokbotConfig } from "@/lib/client/grokbot-store";
import { setShowFileResult } from "../showFileResultsStore";
import { setPendingAskUserQuestions } from "../askUserQuestionsStore";
import {
  scheduleStreamingUpdate,
  flushStreamingUpdateSync,
  startStreaming as startStreamingStore,
  endStreaming as endStreamingStore,
} from "../streamingMessageStore";
import { bashCommandTouchesGit, isBodyMessage, sameCompletedMessage } from "./utils";
import {
  isPortedSessionEvent,
  reduceSessionEvent,
  type SessionEvent,
  type SessionEventEffect,
} from "@/lib/shared/session-events";
import type { AgentRuntimeState, StreamAction, ToastNotification, ThinkingLevelOption } from "./types";

function getSpawnSubagentToolCallIds(message: unknown): string[] {
  if (!message || typeof message !== "object") return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const value = block as { type?: unknown; toolName?: unknown; toolCallId?: unknown };
    return value.type === "toolCall" && value.toolName === "spawn_subagent" && typeof value.toolCallId === "string"
      ? [value.toolCallId]
      : [];
  });
}

const WORKTREE_MUTATING_TOOL_NAMES = new Set(["edit", "write"]);
const BOT_BASELINE_STATE = "searching";
const BOT_REVERT_MS = 8000;

type PermissionRef = {
  current: {
    addRequest: (request: {
      toolCallId: string;
      ruleName: string;
      command: string;
      sessionId: string;
    }) => void;
  } | null;
};

type AgentSessionEventsOptions = {
  controllerId: string;
  isActive: boolean;
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onFirstAssistantReady?: () => void;
  permissionsRef: PermissionRef;
  statsEmitRef: { current: ToolCallStatsDispatch | undefined };
  sessionIdRef: { current: string | null };
  dispatch: Dispatch<StreamAction>;
  /** The one session runtime state object this controller holds. The switch
   *  reads ledgers / in-flight tools / the running flag from here, and writes
   *  every state change through `patchRuntime`. */
  runtimeStateRef: { current: SessionRuntimeState };
  patchRuntime: <K extends keyof SessionRuntimeState>(
    key: K,
    value: StateUpdater<SessionRuntimeState[K]>,
  ) => void;
  /** Commits a whole runtime state object produced by the pure reducer. */
  commitRuntime: (next: SessionRuntimeState) => void;
  pendingAssistantErrorRef: { current: string | null };
  lastAssistantIsBodyRef: { current: boolean };
  botRevertTimerRef: { current: ReturnType<typeof setTimeout> | null };
  pendingNewSessionFirstAssistantRef: { current: boolean };
  refreshSystemPrompt: () => void;
  loadSession: (sid: string, showLoading?: boolean, includeState?: boolean) => Promise<AgentRuntimeState | null>;
  refreshAgentRuntimeStateRef: { current: ((sid?: string) => Promise<AgentRuntimeState | null>) | null };
  closeEvents: () => void;
  scheduleSubagentRefresh: (toolCallId: string) => void;
  compactInFlightRef: { current: boolean };
  showToast: (notification: ToastNotification) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

export function useAgentSessionEvents(options: AgentSessionEventsOptions) {
  const handlerRef = useRef<((event: SessionEvent) => void) | null>(null);
  const {
    controllerId,
    isActive,
    session,
    newSessionCwd,
    onAgentEnd,
    onFirstAssistantReady,
    permissionsRef,
    statsEmitRef,
    sessionIdRef,
    runtimeStateRef,
    patchRuntime,
    commitRuntime,
    dispatch,
    pendingAssistantErrorRef,
    lastAssistantIsBodyRef,
    botRevertTimerRef,
    pendingNewSessionFirstAssistantRef,
    refreshSystemPrompt,
    loadSession,
    refreshAgentRuntimeStateRef,
    closeEvents,
    scheduleSubagentRefresh,
    compactInFlightRef,
    showToast,
    t,
  } = options;

  const handleAgentEvent = useCallback((event: SessionEvent) => {
    const fireDiscreteBot = (stateKey: string) => {
      if (!isActive) return;
      if (botRevertTimerRef.current !== null) clearTimeout(botRevertTimerRef.current);
      setGrokbotConfig({ stateKey });
      botRevertTimerRef.current = setTimeout(() => {
        botRevertTimerRef.current = null;
        setGrokbotConfig({ stateKey: BOT_BASELINE_STATE });
      }, BOT_REVERT_MS);
    };
    const setBaselineBot = () => {
      if (!isActive) return;
      if (botRevertTimerRef.current !== null) {
        clearTimeout(botRevertTimerRef.current);
        botRevertTimerRef.current = null;
      }
      setGrokbotConfig({ stateKey: BOT_BASELINE_STATE });
    };

    /** The runtime state as of this event. Reads (ledgers, in-flight tools,
     *  the running flag) go through here so there is one source of truth. */
    const runtime = () => runtimeStateRef.current;

    /** Perform one effect the pure reducer asked for. This is the only place
     *  the ported paths touch a confirmation dialog, a store or the sound
     *  player — the reducer itself knows none of them. */
    const runEffect = (effect: SessionEventEffect) => {
      const sid = sessionIdRef.current;
      switch (effect.kind) {
        case "enqueue_permission_request":
          if (!sid) return;
          permissionsRef.current?.addRequest({
            toolCallId: effect.toolCallId,
            ruleName: effect.ruleName,
            command: effect.command,
            sessionId: sid,
          });
          return;
        case "set_pending_ask_user_questions":
          if (!sid) return;
          setPendingAskUserQuestions(sid, {
            toolCallId: effect.request.toolCallId,
            questions: effect.request.questions,
            ts: effect.request.ts,
          });
          return;
        case "play_ui_sound":
          playUiSoundEvent(effect.sound);
          return;
      }
    };

    // The ported paths (#60–#63) run through the pure reducer; every other
    // event still goes to the legacy switch below until #64 deletes it.
    if (isPortedSessionEvent(event)) {
      const reduction = reduceSessionEvent(runtimeStateRef.current, event);
      commitRuntime(reduction.state);
      for (const effect of reduction.effects) runEffect(effect);
      return;
    }

    switch (event.type) {
      case "agent_start":
        patchRuntime("runtimeError", null);
        patchRuntime("agentRunning", true);
        patchRuntime("isCompacting", false);
        patchRuntime("agentPhase", { kind: "waiting_model" });
        dispatch({ type: "start" });
        startStreamingStore(controllerId);
        statsEmitRef.current?.({ type: "reset" });
        refreshSystemPrompt();
        lastAssistantIsBodyRef.current = false;
        setBaselineBot();
        break;
      case "agent_end":
        patchRuntime("agentRunning", false);
        patchRuntime("isCompacting", false);
        patchRuntime("agentPhase", null);
        patchRuntime("retryInfo", null);
        dispatch({ type: "end" });
        const hadAssistantError = pendingAssistantErrorRef.current !== null;
        // A failed model call is still part of the active turn. Keep the
        // final streaming snapshot mounted so the view does not disappear
        // while the caller decides whether to retry.
        endStreamingStore(controllerId, hadAssistantError);
        if (pendingAssistantErrorRef.current) {
          patchRuntime("runtimeError", pendingAssistantErrorRef.current);
          showToast({ kind: "error", message: pendingAssistantErrorRef.current });
          pendingAssistantErrorRef.current = null;
        }
        // Fire the completion/failure sound regardless of which workspace
        // tab the user is currently looking at. Toasts stay gated by
        // `isActive` (so a background tab's error doesn't overlay the
        // foreground content), but the sound is a pure notification — if
        // the user has switched away to another session tab, they still
        // need to know the background agent finished. Without this, an
        // `agent_end` arriving while a non-active tab is focused would be
        // silent.
        if (hadAssistantError) {
          playUiSoundEvent("agent_failure");
        } else if (lastAssistantIsBodyRef.current) {
          playUiSoundEvent("agent_success");
        }
        fireDiscreteBot(lastAssistantIsBodyRef.current ? "happy" : "waking");
        if (sessionIdRef.current) {
          const endedSessionId = sessionIdRef.current;
          void (async () => {
            await loadSession(endedSessionId);
            try { await refreshAgentRuntimeStateRef.current?.(endedSessionId); } catch { /* best effort */ }
            if (!runtime().agentRunning) closeEvents();
          })();
        } else {
          closeEvents();
        }
        onAgentEnd?.();
        break;
      case "message_start":
      case "message_update": {
        const message = event.message as Partial<AgentMessage> | undefined;
        for (const toolCallId of getSpawnSubagentToolCallIds(message)) {
          if (!runtime().seenSubagentToolCallIds.claim(toolCallId)) continue;
          patchRuntime("subagentRefreshKey", (key) => key + 1);
          scheduleSubagentRefresh(toolCallId);
        }
        if (message && message.role !== "user") {
          const normalized = normalizeToolCalls(message as AgentMessage);
          // Both flags flip to true here. We never publish the actual
          // message through the reducer — it lives in the standalone
          // streaming store, so per-token updates only re-render
          // StreamingBubble (not the whole ChatWindowContent tree).
          dispatch({ type: "start" });
          startStreamingStore(controllerId);
          // rAF-coalesced: many tokens per frame → at most one snapshot flip.
          scheduleStreamingUpdate(controllerId, normalized);
        }
        patchRuntime("agentPhase", null);
        break;
      }
      case "message_end": {
        const completed = event.message as AgentMessage | undefined;
        for (const toolCallId of getSpawnSubagentToolCallIds(completed)) {
          if (!runtime().seenSubagentToolCallIds.claim(toolCallId)) continue;
          patchRuntime("subagentRefreshKey", (key) => key + 1);
          scheduleSubagentRefresh(toolCallId);
        }
        if (completed && completed.role !== "user") {
          const normalized = normalizeToolCalls(completed);
          // Force-flush any pending streaming message before clearing the
          // stream flag, so the final state isn't lost if a token arrived
          // in the same frame as message_end.
          flushStreamingUpdateSync(controllerId, normalized);
          patchRuntime("messages", (previous) => previous.some((message) => sameCompletedMessage(message, normalized))
            ? previous
            : [...previous, normalized]);
        }
        if (completed?.role === "assistant" && pendingNewSessionFirstAssistantRef.current) {
          pendingNewSessionFirstAssistantRef.current = false;
          onFirstAssistantReady?.();
        }
        dispatch({ type: "reset" });
        if (completed?.role === "assistant" && completed.stopReason === "error") {
          pendingAssistantErrorRef.current = completed.errorMessage ?? "Model call failed";
        }
        // Do not tear down the live view for a model error. The turn can be
        // retried, and the user should keep seeing the current assistant
        // message instead of a blank gap until the next stream starts.
        endStreamingStore(controllerId, completed?.role === "assistant" && completed.stopReason === "error");
        patchRuntime("agentPhase", { kind: "waiting_model" });
        if (completed?.role === "assistant") {
          lastAssistantIsBodyRef.current = isBodyMessage(completed);
          if (sessionIdRef.current) {
            fetch(`/api/agent/${encodeURIComponent(sessionIdRef.current)}`)
              .then((response) => response.json())
              .then((data: { state?: { contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null; contextComposition?: ContextComposition | null } }) => {
                if (data.state?.contextUsage !== undefined) patchRuntime("contextUsage", data.state.contextUsage ?? null);
                // The server recomputes the composition on this same
                // `message_end`, so the round trip that fetches `contextUsage`
                // usually brings the fresh estimate along with it.
                if (data.state?.contextComposition !== undefined) patchRuntime("contextComposition", data.state.contextComposition ?? null);
              })
              .catch(() => {});
          }
        }
        break;
      }
      case "session_tree_update":
        if (Array.isArray(event.tree)) patchRuntime("liveTree", event.tree as SessionTreeNode[]);
        if (typeof event.leafId === "string") patchRuntime("activeLeafId", event.leafId);
        break;
      case "tool_execution_start": {
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        const args = event.args;
        patchRuntime("inFlightTools", (previous) => upsertInFlightTool(previous, id, name, args));
        if (name === "spawn_subagent" && id && runtime().seenSubagentToolStartIds.claim(id)) {
          patchRuntime("subagentRefreshKey", (key) => key + 1);
          scheduleSubagentRefresh(id);
        }
        statsEmitRef.current?.({
          type: "tool_start",
          toolCallId: id,
          toolName: name,
          timestamp: Date.now(),
          args: args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : undefined,
        });
        patchRuntime("agentPhase", (previous) => {
          const tools = previous?.kind === "running_tools" ? [...previous.tools] : [];
          if (!tools.some((tool) => tool.id === id)) {
            tools.push({
              id,
              name,
              args: args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : undefined,
            });
          }
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "tool_execution_update": {
        const id = event.toolCallId as string;
        const partial = event.partialResult as { content?: Array<{ type?: string; text?: string }>; details?: unknown } | undefined;
        if (!id || !partial) break;
        const content: TextContent[] = [];
        if (Array.isArray(partial.content)) {
          for (const block of partial.content) {
            if (block?.type === "text" && typeof block.text === "string") content.push({ type: "text", text: block.text });
          }
        }
        // Details (e.g. spawn_subagent's running taskId/child sessionId) are
        // merged alongside the streaming content so in-flight blocks can
        // react to them before the final result arrives.
        if (content.length === 0 && partial.details === undefined) break;
        patchRuntime("inFlightTools", (previous) => {
          const existing = previous.get(id);
          if (!existing) return previous;
          const next = new Map(previous);
          next.set(id, {
            ...existing,
            result: {
              ...existing.result,
              ...(content.length > 0 ? { content } : {}),
              ...(partial.details !== undefined ? { details: partial.details } : {}),
            } as ToolResultMessage,
          });
          return next;
        });
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId as string;
        const isError = event.isError === true;
        if (isError) fireDiscreteBot("suspicious");
        const result = event.result as { content?: Array<{ type?: string; text?: string }>; details?: unknown } | undefined;
        // `tool_execution_end` repeats only the tool name and carries no args:
        // both come from the in-flight record written at start.
        const inFlight = runtime().inFlightTools.get(id);
        const toolName = inFlight?.name ?? (typeof event.toolName === "string" ? event.toolName : undefined);
        if (toolName === "spawn_subagent" && id && runtime().seenSubagentToolEndIds.claim(id)) {
          patchRuntime("subagentRefreshKey", (key) => key + 1);
          scheduleSubagentRefresh(id);
        }
        const gitCwd = session?.cwd ?? newSessionCwd;
        if (toolName && WORKTREE_MUTATING_TOOL_NAMES.has(toolName) && gitCwd) notifyMutated(gitCwd);
        // bash can also mutate the worktree when the command runs a git
        // subcommand. The end event doesn't carry args, so we read them
        // from the scratchpad we populated on _start. Read-only commands
        // (git status, git log) match too, but the wasted fetch is
        // negligible. We pass `force = true` so git-level changes (`git
        // add` / `git commit` / `git stash`) are reflected immediately
        // instead of falling into the server's 2s status cache behind an
        // earlier edit-triggered fetch.
        if (toolName === "bash" && gitCwd && bashCommandTouchesGit(inFlight?.args)) {
          notifyMutated(gitCwd, true);
        }
        if (toolName && isShowFileToolName(toolName) && result?.details) {
          const files = (result.details as { files?: unknown }).files;
          if (Array.isArray(files)) setShowFileResult(id, files as Parameters<typeof setShowFileResult>[1]);
        }
        if (toolName === CELEBRATE_TOOL_NAME && id && runtime().seenCelebrateToolEndIds.claim(id)) {
          const details = result?.details as CelebrateDetails | undefined;
          triggerCelebration(details);
        }
        let resultText: string | undefined;
        if (result && Array.isArray(result.content)) {
          const firstText = result.content.find((content) => content?.type === "text" && typeof content.text === "string");
          if (firstText && typeof firstText.text === "string") resultText = firstText.text.length > 1024 ? `${firstText.text.slice(0, 1024)}…` : firstText.text;
        }
        statsEmitRef.current?.({ type: "tool_end", toolCallId: id, isError, timestamp: Date.now(), resultText, resultDetails: result?.details });
        patchRuntime("inFlightTools", (previous) => removeInFlightTool(previous, id));
        patchRuntime("agentPhase", (previous) => {
          if (previous?.kind !== "running_tools") return previous;
          const tools = previous.tools.filter((tool) => tool.id !== id);
          return tools.length === 0 ? { kind: "waiting_model" } : { kind: "running_tools", tools };
        });
        break;
      }
      case "auto_retry_start":
        patchRuntime("retryInfo", { attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined });
        break;
      case "prompt_failed": {
        patchRuntime("agentRunning", false);
        patchRuntime("isCompacting", false);
        patchRuntime("agentPhase", null);
        patchRuntime("retryInfo", null);
        dispatch({ type: "end" });
        endStreamingStore(controllerId);
        const errorMessage = event.error as string | undefined || t("Failed to send message");
        patchRuntime("runtimeError", errorMessage);
        showToast({ kind: "error", message: errorMessage });
        closeEvents();
        break;
      }
      case "auto_retry_end":
        patchRuntime("retryInfo", null);
        if (event.success === false) {
          const finalError = event.finalError as string | undefined;
          if (finalError) {
            patchRuntime("runtimeError", finalError);
            showToast({ kind: "error", message: finalError });
            pendingAssistantErrorRef.current = null;
            playUiSoundEvent("agent_failure");
          }
        }
        break;
      case "compaction_start":
        patchRuntime("agentRunning", true);
        patchRuntime("isCompacting", true);
        patchRuntime("agentPhase", { kind: "compacting" });
        break;
      case "compaction_end": {
        const willRetry = event.willRetry === true;
        patchRuntime("isCompacting", false);
        if (willRetry) {
          patchRuntime("agentRunning", true);
          patchRuntime("agentPhase", { kind: "waiting_model" });
        } else {
          patchRuntime("agentRunning", false);
          patchRuntime("agentPhase", null);
          dispatch({ type: "end" });
          endStreamingStore(controllerId);
        }
        if (event.errorMessage && !compactInFlightRef.current) showToast({ kind: "error", message: event.errorMessage as string });
        const compactSessionId = sessionIdRef.current;
        if (!willRetry) {
          void (async () => {
            if (!event.aborted && compactSessionId) await loadSession(compactSessionId);
            if (!runtime().agentRunning) closeEvents();
          })();
        }
        break;
      }
      case "thinking_level_changed": {
        const level = event.level;
        if (typeof level === "string") patchRuntime("thinkingLevel", level as ThinkingLevelOption);
        break;
      }
    }
  }, [
    botRevertTimerRef,
    closeEvents,
    commitRuntime,
    compactInFlightRef,
    controllerId,
    dispatch,
    isActive,
    lastAssistantIsBodyRef,
    loadSession,
    newSessionCwd,
    onAgentEnd,
    onFirstAssistantReady,
    patchRuntime,
    pendingAssistantErrorRef,
    pendingNewSessionFirstAssistantRef,
    permissionsRef,
    refreshAgentRuntimeStateRef,
    refreshSystemPrompt,
    runtimeStateRef,
    scheduleSubagentRefresh,
    session?.cwd,
    sessionIdRef,
    showToast,
    statsEmitRef,
    t,
  ]);

  handlerRef.current = handleAgentEvent;
  return { handleAgentEvent, handleAgentEventRef: handlerRef };
}
