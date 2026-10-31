"use client";

import { useState, useCallback, useRef, useEffect, useReducer, useMemo } from "react";
import type { AgentMessage, ChangeMarker, SessionTreeNode, TextContent, UserMessage, ToolInfo, ToolSelection, CompactionPoint } from "@/lib/shared/types";
import { sendAgentCommand } from "@/lib/client/agent-client";
import { readLastUsedModel, writeLastUsedModel } from "@/lib/client/last-used-model";
import { useModelIconPreferencesSync } from "@/lib/client/useModelIconPreferencesSync";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "../useI18n";
import { usePendingPermissionsRef } from "../usePendingPermissions";
import { setSessionUiState, setLeafChangeHandler } from "../sessionUiStore";
import { setSessionPermissionMode } from "../permissionModeStore";
import { getPendingAskUserQuestions } from "../askUserQuestionsStore";
import { pickClosestAvailableThinkingLevel } from "@/lib/shared/thinking-level-utils";
import {
  createSessionRuntimeState,
  deriveSessionUiPublish,
  inFlightToolResultsOf,
  patchSessionRuntimeState,
  type SessionRuntimeState,
  type StateUpdater,
} from "@/lib/shared/session-runtime-state";
import { streamReducer } from "./utils";
import { useAgentSessionEvents } from "./events";
import {
  endStreaming as endStreamingStore,
  startStreaming as startStreamingStore,
} from "../streamingMessageStore";
import { useAgentSessionTransport } from "./transport";
import { useAgentSessionData } from "./data";
import type { SessionEvent, SessionRuntimeInput } from "@/lib/shared/session-events";
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from "@/lib/shared/permission-mode";
import { parseSkillCommand } from "@/lib/shared/skill-block";
import type {
  AgentPhase,
  AgentRuntimeState,
  AttachedImage,
  SessionData,
  SessionModelOption,
  ThinkingLevelOption,
  TransportRefs,
  UseAgentSessionOptions,
  UseAgentSessionResult,
} from "./types";

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function useAgentSession(opts: UseAgentSessionOptions): UseAgentSessionResult {
  const {
    session, newSessionCwd, onAgentEnd, onSessionCreated, onFirstAssistantReady,
    modelsRefreshKey,
    scrollToEntryId, onEntryNavigated, isActive = true, controllerId,
  } = opts;
  const streamingKey = controllerId ?? session?.id ?? "default";
  const { t } = useI18n();
  const toast = useToast();
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const showToast = useCallback((notification: Parameters<typeof toast.show>[0]) => {
    if (isActiveRef.current) toast.show(notification);
  }, [toast]);
  const permissionsRef = usePendingPermissionsRef();

  const isNew = session === null;

  const [data, setData] = useState<SessionData | null>(null);
  const [runtimeState, setRuntimeState] = useState<SessionRuntimeState>(() => {
    const state = createSessionRuntimeState();
    const pending = session ? getPendingAskUserQuestions(session.id) : null;
    if (pending) state.seenAskUserQuestionsToolCallIds.claim(pending.toolCallId);
    return state;
  });
  const runtimeStateRef = useRef(runtimeState);
  const commitRuntime = useCallback((next: SessionRuntimeState) => {
    if (next === runtimeStateRef.current) return;
    runtimeStateRef.current = next;
    setRuntimeState(next);
  }, []);
  const patchRuntime = useCallback(<K extends keyof SessionRuntimeState>(
    key: K,
    value: StateUpdater<SessionRuntimeState[K]>,
  ) => {
    commitRuntime(patchSessionRuntimeState(runtimeStateRef.current, key, value));
  }, [commitRuntime]);
  const setRuntimeError = useCallback((value: StateUpdater<string | null>) => patchRuntime("runtimeError", value), [patchRuntime]);
  const setActiveLeafId = useCallback((value: StateUpdater<string | null>) => patchRuntime("activeLeafId", value), [patchRuntime]);
  const setLiveTree = useCallback((value: StateUpdater<SessionTreeNode[] | null>) => patchRuntime("liveTree", value), [patchRuntime]);
  const setMessages = useCallback((value: StateUpdater<AgentMessage[]>) => patchRuntime("messages", value), [patchRuntime]);
  const setSubagentRefreshKey = useCallback((value: StateUpdater<number>) => patchRuntime("subagentRefreshKey", value), [patchRuntime]);
  const setAgentPhase = useCallback((value: StateUpdater<AgentPhase>) => patchRuntime("agentPhase", value), [patchRuntime]);
  const setThinkingLevel = useCallback((value: StateUpdater<ThinkingLevelOption>) => patchRuntime("thinkingLevel", value), [patchRuntime]);
  const setAgentRunningSync = useCallback((running: boolean) => patchRuntime("agentRunning", running), [patchRuntime]);
  const setCompactingSync = useCallback((compacting: boolean) => patchRuntime("isCompacting", compacting), [patchRuntime]);
  const isAgentRunning = useCallback(() => runtimeStateRef.current.agentRunning, []);
  const inFlightTools = runtimeState.inFlightTools;
  const inFlightToolResults = useMemo(
    () => inFlightToolResultsOf(inFlightTools),
    [inFlightTools],
  );
  const [loading, setLoading] = useState(session !== null);
  const [error, setError] = useState<string | null>(null);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [entryTimestamps, setEntryTimestamps] = useState<(number | undefined)[]>([]);
  const [compactionPoints, setCompactionPoints] = useState<CompactionPoint[]>([]);
  const [changeMarkers, setChangeMarkers] = useState<ChangeMarker[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
  const subagentRefreshTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const scheduledSubagentRefreshIdsRef = useRef<Set<string>>(new Set());
  const scheduleSubagentRefresh = useCallback((toolCallId: string) => {
    if (scheduledSubagentRefreshIdsRef.current.has(toolCallId)) return;
    scheduledSubagentRefreshIdsRef.current.add(toolCallId);
    const timer = setTimeout(() => {
      subagentRefreshTimersRef.current.delete(toolCallId);
      setSubagentRefreshKey((key) => key + 1);
    }, 30_000);
    subagentRefreshTimersRef.current.set(toolCallId, timer);
  }, [setSubagentRefreshKey]);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelIcons, setModelIcons] = useState<Record<string, string>>({});
  const [modelIconPreferences, setModelIconPreferences] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<SessionModelOption[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModelState] = useState<{ provider: string; modelId: string } | null>(null);
  const [newSessionPermissionMode, setNewSessionPermissionMode] =
    useState<PermissionMode>(DEFAULT_PERMISSION_MODE);
  const [toolSelection, setToolSelection] = useState<ToolSelection>(() => "all");
  useEffect(() => {
    if (!isNew || !newSessionCwd) return;
    let cancelled = false;
    const load = () => {
      fetch(`/api/cwd-tools?cwd=${encodeURIComponent(newSessionCwd)}`)
        .then((res) => res.json() as Promise<{ selection?: ToolSelection | null }>)
        .then((data) => {
          if (!cancelled) setToolSelection(data.selection ?? "all");
        })
        .catch(() => {});
    };
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ cwd?: string }>).detail;
      if (!detail?.cwd || detail.cwd === newSessionCwd) load();
    };
    load();
    window.addEventListener("cwd-tools-changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("cwd-tools-changed", onChanged);
    };
  }, [isNew, newSessionCwd]);
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const eventSourceSessionRef = useRef<string | null>(null);
  const transportGenerationRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const disposedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const compactInFlightRef = useRef(false);
  const botRevertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleAgentEventRef = useRef<((event: SessionEvent) => void) | null>(null);
  const handledScrollEntryRef = useRef<string | null>(null);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const userJustSentRef = useRef(false);

  const setNewSessionModel = opts.setNewSessionModel ?? setNewSessionModelState;

  const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
  const displayModel = isNew ? newSessionModel : currentModel;
  const permissionMode: PermissionMode = isNew
    ? newSessionPermissionMode
    : runtimeState.permissionMode;

  const availableThinkingLevels = displayModel
    ? modelThinkingLevels[`${displayModel.provider}:${displayModel.modelId}`]
    : undefined;
  useEffect(() => {
    const next = pickClosestAvailableThinkingLevel(runtimeState.thinkingLevel, availableThinkingLevels);
    if (next !== runtimeState.thinkingLevel) setThinkingLevel(next);
  }, [availableThinkingLevels, runtimeState.thinkingLevel, setThinkingLevel]);

  const userMessageHistory = useMemo(() => {
    const out: string[] = [];
    for (const m of runtimeState.messages) {
      if (m.role !== "user") continue;
      const userMsg = m as UserMessage;
      let text: string;
      if (typeof userMsg.content === "string") {
        text = userMsg.content;
      } else {
        text = userMsg.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("");
      }
      text = text.replace(/^\[(?:steer|followup)\]\s+/, "");
      if (text.trim()) out.push(text);
    }
    return out.length > 100 ? out.slice(-100) : out;
  }, [runtimeState.messages]);
  const currentSessionId: string | null = data?.sessionId ?? sessionIdRef.current ?? null;

  const sessionStats = useMemo(() => {
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let cost = 0;
    for (const msg of runtimeState.messages) {
      if (msg.role !== "assistant") continue;
      const u = (msg as import("@/lib/shared/types").AssistantMessage).usage;
      if (!u) continue;
      tokens.input += u.input ?? 0;
      tokens.output += u.output ?? 0;
      tokens.cacheRead += u.cacheRead ?? 0;
      tokens.cacheWrite += u.cacheWrite ?? 0;
      cost += u.cost?.total ?? 0;
    }
    const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    if (total <= 0) return null;
    const inputDenom = tokens.input + tokens.cacheRead;
    const cachedHitRate = inputDenom > 0 ? tokens.cacheRead / inputDenom : 0;
    return { tokens, cost, cachedHitRate };
  }, [runtimeState.messages]);

  const transportRefs: TransportRefs = {
    eventSource: eventSourceRef,
    eventSourceSession: eventSourceSessionRef,
    generation: transportGenerationRef,
    reconnectTimer: reconnectTimerRef,
    reconnectAttempt: reconnectAttemptRef,
    disposed: disposedRef,
    sessionId: sessionIdRef,
    isAgentRunning,
  };
  const loadContextRef = useRef<(sid: string, leafId: string | null) => Promise<void>>(async () => {});
  const refreshAgentRuntimeStateRef = useRef<((sid?: string) => Promise<AgentRuntimeState | null>) | null>(null);
  const applyRuntimeInputRef = useRef<(input: SessionRuntimeInput) => void>(() => {});
  const {
    loadSession,
    loadContext: loadContextBound,
    ensureAvailableTools: ensureAvailableToolsImpl,
    refreshAgentRuntimeState,
  } = useAgentSessionData({
    sessionIdRef,
    modelThinkingLevels,
    setData,
    setActiveLeafId,
    setMessages,
    setEntryIds,
    setEntryTimestamps,
    setCompactionPoints,
    setChangeMarkers,
    setCurrentModelOverride,
    setThinkingLevel,
    applyRuntimeInput: (input) => applyRuntimeInputRef.current(input),
    setLoading,
    setError,
    setToolsLoading,
    setToolsError,
    setAvailableTools,
    onSessionLoaded: () => setLiveTree(null),
    isNew,
    newSessionCwd,
    loadContextRef,
    refreshAgentRuntimeStateRef,
  });
  const loadContext = loadContextBound;
  const ensureAvailableTools = useCallback(() => {
    return ensureAvailableToolsImpl(availableTools.length, toolsLoading);
  }, [ensureAvailableToolsImpl, availableTools.length, toolsLoading]);
  const { closeEvents, connectEvents, ensureEventsConnected } = useAgentSessionTransport({
    refs: transportRefs,
    handleAgentEventRef,
    onConnectCompensate: async (sid: string) => {
      await loadContextRef.current(sid, null);
      try { await refreshAgentRuntimeStateRef.current?.(sid); } catch {}
    },
    onConnectionClosed: () => {},
    t,
  });

  const refreshSystemPrompt = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    fetch(`/api/agent/${encodeURIComponent(sid)}`)
      .then((r) => r.json())
      .then((d: { state?: { systemPrompt?: string } }) => {
        if (d.state?.systemPrompt !== undefined) setSystemPrompt(d.state.systemPrompt ?? null);
      })
      .catch(() => {});
  }, []);

  const { handleAgentEvent, applyRuntimeInput } = useAgentSessionEvents({
    controllerId: streamingKey,
    isActive,
    session,
    newSessionCwd,
    onAgentEnd,
    onFirstAssistantReady,
    permissionsRef,
    sessionIdRef,
    runtimeStateRef,
    patchRuntime,
    commitRuntime,
    dispatch,
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
    t,
  });
  handleAgentEventRef.current = handleAgentEvent;
  applyRuntimeInputRef.current = applyRuntimeInput;

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    if (!message.trim() && !images?.length) return;
    if (isAgentRunning()) return;
    if (isNew && !newSessionCwd) {
      showToast({ kind: "error", message: t("Select a project first") });
      return;
    }

    const imageBlocks = images?.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } }));
    const userMsg: AgentMessage = {
      role: "user",
      content: imageBlocks?.length
        ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
        : message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setRuntimeError(null);
    setAgentRunningSync(true);
    setCompactingSync(false);
    setAgentPhase({ kind: "waiting_model" });
    dispatch({ type: "start" });
    startStreamingStore(streamingKey);
    pendingScrollToUserRef.current = true;
    userJustSentRef.current = true;

    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));

    try {
      const sendModel = isNew && newSessionCwd ? newSessionModel : currentModel;
      if (sendModel) {
        writeLastUsedModel({ provider: sendModel.provider, modelId: sendModel.modelId });
      }
      if (isNew && newSessionCwd) {
        const selectedModel = newSessionModel;
        if (selectedModel) setPendingModel(selectedModel);
        const toolNames: ToolSelection = toolSelection;
        const res = await fetch("/api/agent/new", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd: newSessionCwd,
            type: "prompt",
            message,
            toolNames,
            ...(piImages?.length ? { images: piImages } : {}),
            ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
            thinkingLevel: runtimeState.thinkingLevel,
            permissionMode: newSessionPermissionMode,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json() as { sessionId: string };
        const realId = result.sessionId;
        sessionIdRef.current = realId;
        connectEvents(realId);
        refreshSystemPrompt();
        patchRuntime("awaitingFirstAssistant", true);
        patchRuntime("permissionMode", newSessionPermissionMode);
        permissionModeKnownRef.current = true;
        onSessionCreated?.({
          id: realId,
          path: "",
          cwd: newSessionCwd,
          name: undefined,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          messageCount: 1,
          firstMessage: message,
          running: false,
          ...(newSessionPermissionMode !== DEFAULT_PERMISSION_MODE
            ? { permissionMode: newSessionPermissionMode }
            : {}),
        });
        if (parseSkillCommand(message)) void loadSession(realId);
      } else if (session) {
        await ensureEventsConnected(session.id);
        await sendAgentCommand(session.id, {
          type: "prompt",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
          request_id: newRequestId(),
        });
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      setMessages((prev) => prev.filter((entry) => entry !== userMsg));
      const message = e instanceof Error && e.message ? e.message : t("Failed to send message");
      setRuntimeError(message);
      showToast({ kind: "error", message });
      setAgentRunningSync(false);
      setCompactingSync(false);
      setAgentPhase(null);
      dispatch({ type: "end" });
      endStreamingStore(streamingKey);
      closeEvents();
    }
  }, [isNew, newSessionCwd, newSessionModel, newSessionPermissionMode, currentModel, toolSelection, runtimeState.thinkingLevel, session, closeEvents, connectEvents, ensureEventsConnected, isAgentRunning, loadSession, onSessionCreated, patchRuntime, refreshSystemPrompt, setAgentPhase, setAgentRunningSync, setCompactingSync, setMessages, setRuntimeError, showToast, streamingKey, t]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
      showToast({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to stop agent") });
    }
  }, [showToast, t]);

  const handleNavigate = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId }).catch(() => {});
    setActiveLeafId(entryId);
    await loadContext(sid, entryId);
  }, [loadContext, setActiveLeafId]);

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    setActiveLeafId(leafId);
    const sid = sessionIdRef.current;
    if (!sid) return;
    await loadContext(sid, leafId);
    if (leafId) {
      sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId }).catch(() => {});
    }
  }, [loadContext, setActiveLeafId]);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    const newModelLevels = modelThinkingLevels[`${provider}:${modelId}`] ?? null;
    const nextLevel = isNew
      ? "off"
      : pickClosestAvailableThinkingLevel(runtimeState.thinkingLevel, newModelLevels);
    const levelChanged = nextLevel !== runtimeState.thinkingLevel;
    if (levelChanged) {
      setThinkingLevel(nextLevel);
    }

    if (isNew) {
      setNewSessionModel({ provider, modelId });
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      setCurrentModelOverride({ provider, modelId });
      if (levelChanged) {
        await sendAgentCommand(sid, { type: "set_thinking_level", level: nextLevel });
      } else if (newModelLevels === null) {
        try {
          const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
          const st = res.ok ? await res.json() as { state?: { thinkingLevel?: string } } : null;
          if (typeof st?.state?.thinkingLevel === "string") {
            setThinkingLevel(st.state.thinkingLevel as ThinkingLevelOption);
          }
        } catch {
        }
      }
      await loadSession(sid);
    } catch (e) {
      console.error("Failed to set model:", e);
      showToast({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to switch model") });
    }
  }, [isNew, loadSession, modelThinkingLevels, runtimeState.thinkingLevel, setNewSessionModel, setThinkingLevel, showToast, t]);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    const model = isNew ? newSessionModel : currentModel;
    const modelKey = model ? `${model.provider}:${model.modelId}` : null;
    const available = modelKey ? modelThinkingLevels[modelKey] ?? null : null;
    const effective: ThinkingLevelOption = available && available.length > 0
      ? pickClosestAvailableThinkingLevel(level, available)
      : level;
    setThinkingLevel(effective);
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level: effective });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
      showToast({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to change thinking level") });
    }
  }, [isNew, newSessionModel, currentModel, modelThinkingLevels, setThinkingLevel, showToast, t]);

  const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
    const sid = sessionIdRef.current;
    if (!sid) {
      setNewSessionPermissionMode(mode);
      return;
    }
    try {
      await sendAgentCommand(sid, { type: "set_permission_mode", mode });
      patchRuntime("permissionMode", mode);
      setSessionPermissionMode(sid, mode);
    } catch (e) {
      console.error("Failed to set permission mode:", e);
      showToast({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to change permission mode") });
    }
  }, [patchRuntime, showToast, t]);

  const handleToolSelectionChange = useCallback(async (selection: ToolSelection) => {
    setToolSelection(selection);
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_tools", toolNames: selection });
    } catch (e) {
      console.error("Failed to set tools:", e);
      showToast({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to change tools") });
    }
  }, [showToast, t]);

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    if (isAgentRunning() || compactInFlightRef.current) {
      showToast({ kind: "error", message: t("Wait for the current turn to end before compacting.") });
      return;
    }
    compactInFlightRef.current = true;
    setAgentRunningSync(true);
    setCompactingSync(true);
    setAgentPhase({ kind: "compacting" });

    try {
      await ensureEventsConnected(sid);
      await sendAgentCommand(sid, { type: "compact" });
      showToast({
        kind: "success",
        message: t("Compacted context"),
      });
      await loadSession(sid);
    } catch (error) {
      console.error("Manual compact failed:", error);
      showToast({
        kind: "error",
        message: `${t("Compact failed")}: ${
          error instanceof Error && error.message ? error.message : t("Network error")
        }`,
      });
      try { await refreshAgentRuntimeState(sid); } catch {}
    } finally {
      compactInFlightRef.current = false;
      setCompactingSync(false);
      if (!isAgentRunning()) {
        setAgentRunningSync(false);
        setAgentPhase(null);
        closeEvents();
      }
    }
  }, [
    closeEvents,
    ensureEventsConnected,
    isAgentRunning,
    loadSession,
    refreshAgentRuntimeState,
    setAgentPhase,
    setAgentRunningSync,
    setCompactingSync,
    showToast,
    t,
  ]);

  const permissionModeKnownRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    permissionModeKnownRef.current = false;
    const mounted = runtimeStateRef.current;
    mounted.seenSubagentToolCallIds.clear();
    mounted.seenSubagentToolStartIds.clear();
    mounted.seenSubagentToolEndIds.clear();
    mounted.seenCelebrateToolEndIds.clear();
    for (const timer of subagentRefreshTimersRef.current.values()) clearTimeout(timer);
    subagentRefreshTimersRef.current.clear();
    scheduledSubagentRefreshIdsRef.current.clear();
    if (session) {
      sessionIdRef.current = session.id;
      loadSession(session.id, true, true).then(async (agentState) => {
        if (disposedRef.current) return;
        permissionModeKnownRef.current = true;
        applyRuntimeInputRef.current({ type: "client_snapshot", snapshot: agentState });
        if (agentState && !agentState.state) {
          refreshAgentRuntimeState(session.id).catch(() => {});
        }
        const live = agentState?.state;
        if (
          agentState?.running === true ||
          live?.isRunning === true ||
          live?.isCompacting === true ||
          live?.isStreaming === true ||
          live?.phase === "compacting" ||
          live?.phase === "streaming"
        ) {
          connectEvents(session.id);
        }
      });
    }
    return () => {
      disposedRef.current = true;
      closeEvents();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!scrollToEntryId) {
      handledScrollEntryRef.current = null;
      return;
    }
    if (loading || handledScrollEntryRef.current === scrollToEntryId) return;
    const sid = sessionIdRef.current;
    if (!sid) return;
    handledScrollEntryRef.current = scrollToEntryId;
    void (async () => {
      setActiveLeafId(scrollToEntryId);
      await loadContextRef.current(sid, scrollToEntryId);
      sendAgentCommand(sid, { type: "navigate_tree", targetId: scrollToEntryId }).catch(() => {});
      onEntryNavigated?.();
    })();
  }, [loading, onEntryNavigated, scrollToEntryId, setActiveLeafId]);

  useEffect(() => {
    const patch = deriveSessionUiPublish(runtimeState, {
      systemPrompt,
      sessionStats,
      isStreaming: streamState.isStreaming,
      diskTree: data?.tree ?? [],
      toolSelection,
      availableTools,
      isNew,
      newSessionModel,
      sessionModel: currentModel,
    }, isActive);
    if (patch) setSessionUiState(patch);
  }, [runtimeState, systemPrompt, sessionStats, streamState.isStreaming, data?.tree, toolSelection, availableTools, isNew, newSessionModel, currentModel, isActive]);

  useEffect(() => {
    if (!currentSessionId) return;
    if (!permissionModeKnownRef.current) return;
    setSessionPermissionMode(currentSessionId, runtimeState.permissionMode);
  }, [currentSessionId, runtimeState.permissionMode]);

  useEffect(() => {
    if (!isActive) return;
    setLeafChangeHandler(handleLeafChange, controllerId);
    return () => setLeafChangeHandler(null, controllerId);
  }, [controllerId, isActive, handleLeafChange]);

  useModelIconPreferencesSync(setModelIconPreferences);

  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then((d: { models: Record<string, string>; modelList?: SessionModelOption[]; defaultModel?: { provider: string; modelId: string } | null; thinkingLevels?: Record<string, string[]>; thinkingLevelMaps?: Record<string, Record<string, string | null>>; modelIcons?: Record<string, string>; modelIconPreferences?: Record<string, string> }) => {
      setModelNames(d.models);
      if (d.modelIcons) setModelIcons(d.modelIcons);
      if (d.modelIconPreferences) setModelIconPreferences(d.modelIconPreferences);
      if (d.thinkingLevels) setModelThinkingLevels(d.thinkingLevels);
      if (d.thinkingLevelMaps) setModelThinkingLevelMaps(d.thinkingLevelMaps);
      if (d.modelList) {
        setModelList(d.modelList);
        if (isNew && d.modelList.length > 0) {
          const def = d.defaultModel;
          const defMatch = def && d.modelList.find((m) => m.id === def.modelId && m.provider === def.provider);
          const lastUsed = readLastUsedModel();
          const lastUsedMatch = lastUsed && d.modelList.find((m) => m.id === lastUsed.modelId && m.provider === lastUsed.provider);
          const selected = lastUsedMatch
            ? { provider: lastUsedMatch.provider, modelId: lastUsedMatch.id }
            : defMatch
              ? { provider: defMatch.provider, modelId: defMatch.id }
              : { provider: d.modelList[0].provider, modelId: d.modelList[0].id };
          setNewSessionModel(selected);
          setThinkingLevel("off");
        }
      }
    }).catch(() => {});
  }, [isNew, modelsRefreshKey, setNewSessionModel, setThinkingLevel]);

  useEffect(() => {
    if (isActive) return;
    if (botRevertTimerRef.current !== null) {
      clearTimeout(botRevertTimerRef.current);
      botRevertTimerRef.current = null;
    }
  }, [isActive]);
  useEffect(() => () => {
    if (botRevertTimerRef.current !== null) {
      clearTimeout(botRevertTimerRef.current);
      botRevertTimerRef.current = null;
    }
    for (const timer of subagentRefreshTimersRef.current.values()) clearTimeout(timer);
    subagentRefreshTimersRef.current.clear();
    scheduledSubagentRefreshIdsRef.current.clear();
  }, []);

  return {
    data, loading, error, entryIds, entryTimestamps, compactionPoints, changeMarkers, inFlightToolResults, streamState,
    runtimeError: runtimeState.runtimeError,
    activeLeafId: runtimeState.activeLeafId,
    messages: runtimeState.messages,
    agentRunning: runtimeState.agentRunning,
    agentPhase: runtimeState.agentPhase,
    retryInfo: runtimeState.retryInfo,
    contextUsage: runtimeState.contextUsage,
    subagentRefreshKey: runtimeState.subagentRefreshKey,
    modelNames, modelIcons, modelIconPreferences, modelList, modelThinkingLevels, modelThinkingLevelMaps, newSessionModel,
    toolSelection, availableTools, toolsLoading, toolsError,
    thinkingLevel: runtimeState.thinkingLevel,
    permissionMode,
    systemPrompt,
    currentModel, displayModel, sessionStats,
    isNew,
    currentSessionId,
    userMessageHistory,
    sessionIdRef, eventSourceRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef, userJustSentRef,
    handleSend, handleAbort, handleNavigate, handleModelChange,
    handleToolSelectionChange, ensureAvailableTools, handleThinkingLevelChange,
    handlePermissionModeChange,
    handleCompact,
  };
}
