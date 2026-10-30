import { useCallback, useRef, type Dispatch } from "react";
import type { SessionInfo, ToolSelection } from "@/lib/shared/types";
import type { ContextComposition } from "@/lib/shared/context-composition";
import type { SessionRuntimeState, StateUpdater } from "@/lib/shared/session-runtime-state";
import { notifyMutated } from "@/lib/client/git-status-store";
import { playUiSoundEvent } from "@/lib/client/ui-sounds";
import { setGrokbotConfig } from "@/lib/client/grokbot-store";
import { triggerCelebration } from "@/lib/client/celebrate-store";
import { setPendingAskUserQuestions } from "../askUserQuestionsStore";
import {
  scheduleStreamingUpdate,
  flushStreamingUpdateSync,
  getStreamingSnapshot,
  startStreaming as startStreamingStore,
  endStreaming as endStreamingStore,
} from "../streamingMessageStore";
import {
  reduceSessionInput,
  type SessionEvent,
  type SessionEventEffect,
  type SessionRuntimeInput,
} from "@/lib/shared/session-events";
import type { AgentRuntimeState, StreamAction, ToastNotification } from "./types";

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
    removeSessionRequests: (sessionId: string) => void;
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
  sessionIdRef: { current: string | null };
  dispatch: Dispatch<StreamAction>;
  runtimeStateRef: { current: SessionRuntimeState };
  patchRuntime: <K extends keyof SessionRuntimeState>(
    key: K,
    value: StateUpdater<SessionRuntimeState[K]>,
  ) => void;
  commitRuntime: (next: SessionRuntimeState) => void;
  botRevertTimerRef: { current: ReturnType<typeof setTimeout> | null };
  refreshSystemPrompt: () => void;
  setSystemPrompt: (value: string | null) => void;
  setToolSelection: Dispatch<React.SetStateAction<ToolSelection>>;
  loadSession: (sid: string, showLoading?: boolean, includeState?: boolean) => Promise<AgentRuntimeState | null>;
  refreshAgentRuntimeStateRef: { current: ((sid?: string) => Promise<AgentRuntimeState | null>) | null };
  closeEvents: () => void;
  scheduleSubagentRefresh: (toolCallId: string) => void;
  compactInFlightRef: { current: boolean };
  showToast: (notification: ToastNotification) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

function performEffect(
  options: AgentSessionEventsOptions,
  effect: SessionEventEffect,
  feedInput: (input: SessionRuntimeInput) => void,
): void {
  const {
    controllerId,
    isActive,
    session,
    newSessionCwd,
    onAgentEnd,
    onFirstAssistantReady,
    permissionsRef,
    sessionIdRef,
    dispatch,
    runtimeStateRef,
    patchRuntime,
    botRevertTimerRef,
    refreshSystemPrompt,
    setSystemPrompt,
    setToolSelection,
    loadSession,
    refreshAgentRuntimeStateRef,
    closeEvents,
    scheduleSubagentRefresh,
    compactInFlightRef,
    showToast,
  } = options;
  const sid = sessionIdRef.current;
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
    case "invalidate_git_status": {
      const cwd = session?.cwd ?? newSessionCwd;
      if (cwd) notifyMutated(cwd, effect.force);
      return;
    }
    case "celebrate":
      triggerCelebration(effect.details);
      return;
    case "refresh_subagent_panel":
      patchRuntime("subagentRefreshKey", (key) => key + 1);
      scheduleSubagentRefresh(effect.toolCallId);
      return;
    case "flash_bot_state":
      fireDiscreteBot(effect.stateKey);
      return;
    case "set_bot_baseline":
      setBaselineBot();
      return;
    case "stream_message":
      dispatch({ type: "start" });
      startStreamingStore(controllerId);
      scheduleStreamingUpdate(controllerId, effect.message);
      return;
    case "begin_stream":
      dispatch({ type: "start" });
      startStreamingStore(controllerId);
      return;
    case "settle_stream":
      if (effect.message) flushStreamingUpdateSync(controllerId, effect.message);
      dispatch({ type: "reset" });
      endStreamingStore(controllerId, effect.keepForError);
      return;
    case "end_streaming_view": {
      dispatch({ type: "end" });
      const streamingMessage = getStreamingSnapshot(controllerId).streamingMessage;
      const modelCallFailed = streamingMessage?.role === "assistant" && streamingMessage.stopReason === "error";
      endStreamingStore(controllerId, modelCallFailed);
      return;
    }
    case "refresh_system_prompt":
      refreshSystemPrompt();
      return;
    case "adopt_system_prompt":
      setSystemPrompt(effect.value);
      return;
    case "adopt_tool_selection": {
      const next = effect.selection;
      setToolSelection((prev) =>
        prev === next || (Array.isArray(prev) && Array.isArray(next)
          && prev.length === next.length && prev.every((name, i) => name === next[i]))
          ? prev
          : next,
      );
      return;
    }
    case "show_error_toast":
      showToast({ kind: "error", message: effect.message });
      return;
    case "show_compaction_error_toast":
      if (!compactInFlightRef.current) showToast({ kind: "error", message: effect.message });
      return;
    case "refresh_context_usage": {
      if (!sid) return;
      fetch(`/api/agent/${encodeURIComponent(sid)}`)
        .then((response) => response.json())
        .then((data: { state?: { contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null; contextComposition?: ContextComposition | null } }) => {
          feedInput({
            type: "client_context_usage",
            contextUsage: data.state?.contextUsage,
            contextComposition: data.state?.contextComposition,
          });
        })
        .catch(() => {});
      return;
    }
    case "first_assistant_ready":
      onFirstAssistantReady?.();
      return;
    case "record_assistant_outcome":
      patchRuntime("lastAssistantIsBody", effect.isBody);
      if (effect.pendingError !== null) patchRuntime("pendingAssistantError", effect.pendingError);
      return;
    case "reload_session_after_turn": {
      if (!sid) {
        closeEvents();
        return;
      }
      void (async () => {
        await loadSession(sid);
        try { await refreshAgentRuntimeStateRef.current?.(sid); } catch {}
        if (!runtimeStateRef.current.agentRunning) closeEvents();
      })();
      return;
    }
    case "reload_session_after_compaction":
      void (async () => {
        if (!effect.aborted && sid) await loadSession(sid);
        if (!runtimeStateRef.current.agentRunning) closeEvents();
      })();
      return;
    case "notify_agent_end":
      if (sid) permissionsRef.current?.removeSessionRequests(sid);
      onAgentEnd?.();
      return;
    case "close_events":
      closeEvents();
      return;
  }
}

export function useAgentSessionEvents(options: AgentSessionEventsOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const applyRuntimeInputRef = useRef<(input: SessionRuntimeInput) => void>(() => {});

  const applyRuntimeInput = useCallback((input: SessionRuntimeInput) => {
    const { runtimeStateRef, commitRuntime } = optionsRef.current;
    const reduction = reduceSessionInput(runtimeStateRef.current, input);
    commitRuntime(reduction.state);
    for (const effect of reduction.effects) {
      performEffect(optionsRef.current, effect, (next) => applyRuntimeInputRef.current(next));
    }
  }, []);
  applyRuntimeInputRef.current = applyRuntimeInput;

  const handleAgentEvent = useCallback((rawEvent: SessionEvent) => {
    const event: SessionEvent = rawEvent.type === "prompt_failed" && !rawEvent.error
      ? { ...rawEvent, error: optionsRef.current.t("Failed to send message") }
      : rawEvent;
    applyRuntimeInput(event);
  }, [applyRuntimeInput]);

  return { handleAgentEvent, applyRuntimeInput };
}
