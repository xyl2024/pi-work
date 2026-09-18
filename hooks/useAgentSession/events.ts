import { useCallback, useRef, type Dispatch } from "react";
import type { SessionInfo, ToolSelection } from "@/lib/shared/types";
import type { ContextComposition } from "@/lib/shared/context-composition";
import type { SessionRuntimeState, StateUpdater } from "@/lib/shared/session-runtime-state";
import type { ToolCallStatsDispatch } from "../ToolCallStatsContext";
import { notifyMutated } from "@/lib/client/git-status-store";
import { playUiSoundEvent } from "@/lib/client/ui-sounds";
import { setGrokbotConfig } from "@/lib/client/grokbot-store";
import { setShowFileResult } from "../showFileResultsStore";
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
  /** The one session runtime state object this controller holds. The adapter
   *  reads (ledgers / in-flight tools / the running flag) from here, and writes
   *  every state change through `patchRuntime` / `commitRuntime`. */
  runtimeStateRef: { current: SessionRuntimeState };
  patchRuntime: <K extends keyof SessionRuntimeState>(
    key: K,
    value: StateUpdater<SessionRuntimeState[K]>,
  ) => void;
  /** Commits a whole runtime state object produced by the pure reducer. */
  commitRuntime: (next: SessionRuntimeState) => void;
  botRevertTimerRef: { current: ReturnType<typeof setTimeout> | null };
  refreshSystemPrompt: () => void;
  /** Adopts the system prompt a snapshot reported. Kept out of the runtime
   *  state on purpose: it is a publish projection *source*, not session
   *  runtime belief. */
  setSystemPrompt: (value: string | null) => void;
  /** Adopts the raw tool selection a snapshot reported. */
  setToolSelection: Dispatch<React.SetStateAction<ToolSelection>>;
  loadSession: (sid: string, showLoading?: boolean, includeState?: boolean) => Promise<AgentRuntimeState | null>;
  refreshAgentRuntimeStateRef: { current: ((sid?: string) => Promise<AgentRuntimeState | null>) | null };
  closeEvents: () => void;
  scheduleSubagentRefresh: (toolCallId: string) => void;
  compactInFlightRef: { current: boolean };
  showToast: (notification: ToastNotification) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

/**
 * Perform one effect the pure reducer asked for. This is the only place the
 * ported paths touch a confirmation dialog, a store or the sound player — the
 * reducer itself knows none of them.
 */
function performEffect(options: AgentSessionEventsOptions, effect: SessionEventEffect): void {
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
  /** The Pi Bot reaction is global (one sidebar companion), so a background
   *  tab must not drive it. */
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
    case "report_tool_call_stats": {
      // The reducer states *what* happened; the clock is read here.
      const timestamp = Date.now();
      const report = effect.report;
      switch (report.type) {
        case "tool_start":
          statsEmitRef.current?.({
            type: "tool_start",
            toolCallId: report.toolCallId,
            toolName: report.toolName,
            args: report.args,
            timestamp,
          });
          return;
        case "tool_end":
          statsEmitRef.current?.({
            type: "tool_end",
            toolCallId: report.toolCallId,
            isError: report.isError,
            resultText: report.resultText,
            resultDetails: report.resultDetails,
            timestamp,
          });
          return;
      }
      return;
    }
    case "invalidate_git_status": {
      const cwd = session?.cwd ?? newSessionCwd;
      if (cwd) notifyMutated(cwd, effect.force);
      return;
    }
    case "show_file_result":
      setShowFileResult(effect.toolCallId, effect.files);
      return;
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
      // The streamed content deliberately lives in its own store so a
      // per-token update re-renders only the streaming bubble, not the
      // whole ChatWindowContent tree. The store coalesces with rAF: many
      // tokens per frame → at most one snapshot flip.
      dispatch({ type: "start" });
      startStreamingStore(controllerId);
      scheduleStreamingUpdate(controllerId, effect.message);
      return;
    case "begin_stream":
      // A new turn opens the live view before the first token arrives.
      dispatch({ type: "start" });
      startStreamingStore(controllerId);
      return;
    case "settle_stream":
      // Force-flush any pending streaming snapshot before clearing the
      // stream flag, so the final state is not lost if a token arrived in
      // the same frame as message_end.
      if (effect.message) flushStreamingUpdateSync(controllerId, effect.message);
      dispatch({ type: "reset" });
      // Do not tear down the live view for a model error: the turn can be
      // retried, and the user should keep seeing the current assistant
      // message instead of a blank gap until the next stream starts.
      endStreamingStore(controllerId, effect.keepForError);
      return;
    case "end_streaming_view": {
      // The snapshot's idle branch: close the live view the way the old
      // direct-write path did, deciding `keepForError` from the store that
      // holds the streaming message (which the reducer cannot see).
      dispatch({ type: "end" });
      const streamingMessage = getStreamingSnapshot(controllerId).streamingMessage;
      const modelCallFailed = streamingMessage?.role === "assistant" && streamingMessage.stopReason === "error";
      endStreamingStore(controllerId, modelCallFailed);
      return;
    }
    case "reset_tool_call_stats":
      statsEmitRef.current?.({ type: "reset" });
      return;
    case "refresh_system_prompt":
      refreshSystemPrompt();
      return;
    case "adopt_system_prompt":
      setSystemPrompt(effect.value);
      return;
    case "adopt_tool_selection": {
      // Identity-stable when the selection is unchanged, so adopting the same
      // snapshot twice cannot loop through re-renders.
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
      // `showToast` is gated on the active tab (a background tab's error
      // must not overlay the foreground content).
      showToast({ kind: "error", message: effect.message });
      return;
    case "show_compaction_error_toast":
      // A manual compaction the user started reports its own failure
      // through the RPC reply; suppress the duplicate SSE toast while that
      // request is still in flight.
      if (!compactInFlightRef.current) showToast({ kind: "error", message: effect.message });
      return;
    case "refresh_context_usage": {
      // The reducer asked for the refresh; the request itself happens here,
      // at the same moment the old inline fetch ran (a finished assistant
      // message).
      if (!sid) return;
      fetch(`/api/agent/${encodeURIComponent(sid)}`)
        .then((response) => response.json())
        .then((data: { state?: { contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null; contextComposition?: ContextComposition | null } }) => {
          if (data.state?.contextUsage !== undefined) patchRuntime("contextUsage", data.state.contextUsage ?? null);
          // The server recomputes the composition on this same
          // `message_end`, so the round trip that fetches `contextUsage`
          // usually brings the fresh estimate along with it.
          if (data.state?.contextComposition !== undefined) patchRuntime("contextComposition", data.state.contextComposition ?? null);
        })
        .catch(() => {});
      return;
    }
    case "first_assistant_ready":
      onFirstAssistantReady?.();
      return;
    case "record_assistant_outcome":
      // The two facts the turn-end branches read: whether the last
      // assistant message was a plain body answer, and the model error it
      // recorded. The error only overwrites when there is one — the old
      // scratchpad behaved the same, so a later clean message does not
      // erase an earlier failure.
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
        try { await refreshAgentRuntimeStateRef.current?.(sid); } catch { /* best effort */ }
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
      onAgentEnd?.();
      return;
    case "close_events":
      closeEvents();
      return;
  }
}

/**
 * The session-input adapter.
 *
 * It is deliberately thin: every input the runtime state can receive — a wire
 * frame or a client-originated snapshot — goes through the one pure
 * `reduceSessionInput`, and this file only
 *
 *   1. translates the SSE frame into the module's vocabulary (the one i18n
 *      fallback lives here, because the reducer cannot translate), and
 *   2. performs the effects the reducer returned — sounds, celebrations, Pi
 *      Bot flashes, toasts, stores, requests, host callbacks.
 *
 * There is no per-event `switch` here and no routing guard: the reducer is total
 * over the protocol, so a frame can never fall through unhandled, and the
 * "deliberately ignored" events come back with the state untouched.
 */
export function useAgentSessionEvents(options: AgentSessionEventsOptions) {
  // The handler runs from the SSE callback, never while React renders. It must
  // not be rebuilt when one of its twenty-odd dependencies gets a new identity:
  // the adapter is the stable identity the transport holds, and the latest
  // options are read through this ref at call time — the same render-phase ref
  // write the hook already uses for `isActiveRef` / `statsEmitRef`.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /**
   * Feed one input to the one reducer, commit the next state and perform the
   * effects. This is the single write path into the runtime state: wire events
   * and client inputs differ only in the union member.
   */
  const applyRuntimeInput = useCallback((input: SessionRuntimeInput) => {
    const { runtimeStateRef, commitRuntime } = optionsRef.current;
    const reduction = reduceSessionInput(runtimeStateRef.current, input);
    commitRuntime(reduction.state);
    for (const effect of reduction.effects) performEffect(optionsRef.current, effect);
  }, []);

  const handleAgentEvent = useCallback((rawEvent: SessionEvent) => {
    // The reducer is pure and cannot translate, so the one user-facing i18n
    // fallback is resolved here, at the boundary, before the event is reduced.
    const event: SessionEvent = rawEvent.type === "prompt_failed" && !rawEvent.error
      ? { ...rawEvent, error: optionsRef.current.t("Failed to send message") }
      : rawEvent;
    applyRuntimeInput(event);
  }, [applyRuntimeInput]);

  return { handleAgentEvent, applyRuntimeInput };
}
