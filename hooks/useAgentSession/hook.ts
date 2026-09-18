"use client";

import { useState, useCallback, useRef, useEffect, useReducer, useMemo } from "react";
import type { AgentMessage, SessionTreeNode, TextContent, UserMessage, ToolInfo, ToolSelection, CompactionPoint } from "@/lib/shared/types";
import { sendAgentCommand } from "@/lib/client/agent-client";
import { readLastUsedModel, writeLastUsedModel } from "@/lib/client/last-used-model";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "../useI18n";
import { usePendingPermissionsRef } from "../usePendingPermissions";
import { setSessionUiState, setLeafChangeHandler, setSystemPromptRefreshHandler } from "../sessionUiStore";
import { getPendingAskUserQuestions } from "../askUserQuestionsStore";
import { pickClosestAvailableThinkingLevel } from "@/lib/shared/thinking-level-utils";
import {
  createSessionRuntimeState,
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
import type {
  AgentPhase,
  AgentRuntimeState,
  AttachedImage,
  SessionData,
  ThinkingLevelOption,
  TransportRefs,
  UseAgentSessionOptions,
} from "./types";



export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session, newSessionCwd, onAgentEnd, onSessionCreated, onFirstAssistantReady,
    modelsRefreshKey, statsEmit,
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
  const statsEmitRef = useRef(statsEmit);
  statsEmitRef.current = statsEmit;

  // "New session" = no session selected yet. Deliberately not gated on
  // newSessionCwd: the very first entry lands on the new-session page before
  // any cwd is picked (AppShell pre-fills the most recent one), so isNew must
  // be true from the start or the welcome screen / model picker would never
  // render. handleSend guards its own creation path with `newSessionCwd`.
  const isNew = session === null;

  const [data, setData] = useState<SessionData | null>(null);
  // Live conversation tree pushed by the server after each message_end (via
  // the synthetic session_tree_update SSE event), so the conversation-tree
  // panel renders new cards without waiting for the whole turn to finish.
  // null = not initialized — falls back to data.tree (loaded from disk).
  //
  // ── The one session runtime state object ────────────────────────────────
  // "What does the client believe this session looks like right now" lives
  // here in a single object — the running flag, phase, retry info, messages,
  // live tree, context usage, the in-flight tool table (name + args + partial
  // result) and the dedupe ledgers. There is deliberately no second ref or
  // useState for any of it: `runtimeStateRef` mirrors the same object so the
  // event adapter and the transport can read it synchronously, while
  // `runtimeState` is what makes React re-render. See
  // lib/shared/session-runtime-state.ts for why this is a shared pure module.
  const [runtimeState, setRuntimeState] = useState<SessionRuntimeState>(() => {
    // A pending ask-user-questions request outlives this controller: the agent
    // is blocked on it and the entry lives in the module store. Mark it as
    // already announced so remounting the tab (reload / close and reopen) does
    // not make the server's reconnect re-emit ring again.
    const state = createSessionRuntimeState();
    const pending = session ? getPendingAskUserQuestions(session.id) : null;
    if (pending) state.seenAskUserQuestionsToolCallIds.claim(pending.toolCallId);
    return state;
  });
  const runtimeStateRef = useRef(runtimeState);
  // The one write path into the runtime state object: identity-preserving (a
  // no-op write does not re-render), and used both by single-field patches and
  // by the pure event reducer, which returns a whole next state.
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
  // Field setters with the same `StateSetter<T>` shape the old useState
  // setters had — the event switch's read/write shape is unchanged, it just
  // writes into the one object now. Stable identities so the data layer's
  // useCallback deps don't churn.
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
  // Derived view of the in-flight tool table: the partial tool results the
  // chat overlays while a call is still running. Identity tracks the tool
  // table only, so a message-only change does not invalidate consumers.
  const inFlightTools = runtimeState.inFlightTools;
  const inFlightToolResults = useMemo(
    () => inFlightToolResultsOf(inFlightTools),
    [inFlightTools],
  );
  // Only existing sessions load from disk — the new-session page (no session
  // yet, cwd possibly still being picked) must never sit in the loading
  // state, otherwise first entry would spin forever on "Loading session...".
  const [loading, setLoading] = useState(session !== null);
  const [error, setError] = useState<string | null>(null);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  // Parallel to entryIds: the entry-level persistence timestamp (ms) for each
  // message, when present. Feeds the per-turn duration display.
  const [entryTimestamps, setEntryTimestamps] = useState<(number | undefined)[]>([]);
  // Compaction points on the visible message path (see SessionContext.compactionPoints).
  // The chat list inserts a divider right before each point's first kept message.
  const [compactionPoints, setCompactionPoints] = useState<CompactionPoint[]>([]);
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
  const [modelList, setModelList] = useState<{ id: string; name: string; provider: string; reasoning?: boolean; input?: string[]; contextWindow?: number; maxTokens?: number; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModelState] = useState<{ provider: string; modelId: string } | null>(null);
  // The user's tool selection state. `[]` ≡ Off, `"all"` ≡ High (every
  // registered tool — sentinel so newly-added tools auto-include), a partial
  // string[] ≡ Custom. New sessions seed it from the cwd preset; existing
  // sessions adopt the live selection reported by `get_state`
  // (set_tools persists it in a sidecar, so restarts restore the same set).
  const [toolSelection, setToolSelection] = useState<ToolSelection>(() => "all");
  // Load the cwd preset for a new-session page. A browser event lets the cwd
  // menu update an already-mounted new-session controller immediately.
  useEffect(() => {
    if (!isNew || !newSessionCwd) return;
    let cancelled = false;
    const load = () => {
      fetch(`/api/cwd-tools?cwd=${encodeURIComponent(newSessionCwd)}`)
        .then((res) => res.json() as Promise<{ selection?: ToolSelection | null }>)
        .then((data) => {
          if (!cancelled) setToolSelection(data.selection ?? "all");
        })
        .catch(() => { /* keep the default */ });
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
  // Catalog of every tool pi registered for this session's cwd. Populated
  // lazily: `ensureAvailableTools` on popover open for new sessions.
  // Sorted alphabetically by name when set.
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  // Fetch lifecycle for availableTools: spinner while in-flight, error string
  // surfaced to the UI. Cleared on every successful fetch.
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
  // Sidebar Pi Bot trigger (event-based, see Pi Bot Lab for visuals): the
  // bot's per-turn reaction is chosen by the pure reducer from the session
  // runtime state (`lastAssistantIsBody` / `pendingAssistantError`), which the
  // `record_assistant_outcome` effect writes and `agent_end` reads. Only the
  // revert timer stays a ref — it is imperative I/O, not session belief.
  //
  //   lastAssistantIsBody — the most recent assistant message in this turn had
  //                         text content with no toolUse; agent_end uses this
  //                         to pick happy vs waking. Reset in agent_start so
  //                         each turn starts fresh. Tool failures are NOT
  //                         tracked here: a tool failure triggers "suspicious"
  //                         on the spot (with its own 8s revert), but it must
  //                         not suppress the final happy/waking reaction at
  //                         agent_end — a turn can recover from a failed tool
  //                         and end with a clean body-text response.
  //   pendingAssistantError — the most recent assistant error, surfaced by
  //                         agent_end.
  // setTimeout handle for the bot's revert-to-baseline timer. Cancel on
  // every new discrete trigger so the latest reaction always gets the
  // full BOT_REVERT_MS window. Cleared on unmount so a stale timer from
  // an unmounted session can't snap the sidebar bot to "searching".
  const botRevertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleAgentEventRef = useRef<((event: SessionEvent) => void) | null>(null);
  const handledScrollEntryRef = useRef<string | null>(null);
  // Chat scroll targets, owned here because the send path needs them
  // (`pendingScrollToUserRef` is set by handleSend). The scroll rules and the
  // DOM writes live in `useScrollFollow`; this hook only reports them.
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // Set by handleSend right before dispatch({type:"start"}). The auto-scroll
  // effect reads it on the next isStreaming false→true transition to tell
  // "user explicitly asked for a response" apart from "isStreaming just
  // flickered because the agent started a new assistant message after a tool
  // call". The former should re-engage sticky-bottom; the latter must not.
  const userJustSentRef = useRef(false);

  const setNewSessionModel = opts.setNewSessionModel ?? setNewSessionModelState;

  const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
  const displayModel = isNew ? newSessionModel : currentModel;

  // Input history for the chat input box. Backed by `messages` (which is
  // already populated from the backend .jsonl via loadSession, then kept
  // up to date by setMessages in handleSend + SSE events), so it always
  // reflects the actual conversation — no localStorage, no race conditions
  // around the isNew path's async sessionId. Older sessions may still hold
  // steer/follow-up entries written before those features were removed; their
  // display prefix is stripped so the recalled text is plain.
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

  const sessionStats = (() => {
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
    // Weighted cache-hit rate across the active leaf path: total cacheRead
    // over total billable prompt (input + cacheRead). cacheWrite is
    // deliberately excluded — it's a one-time write cost, not a recurring
    // read. Providers that don't report caching (OpenAI-style) yield 0.
    const inputDenom = tokens.input + tokens.cacheRead;
    const cachedHitRate = inputDenom > 0 ? tokens.cacheRead / inputDenom : 0;
    return { tokens, cost, cachedHitRate };
  })();

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
  // The reducer's entry point lives in the event adapter, which is created
  // after the data layer (it needs `loadSession` / `closeEvents`). The data
  // layer reaches it through this ref, filled on the same render — the same
  // bridge shape as `refreshAgentRuntimeStateRef` / `loadContextRef`.
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
      try { await refreshAgentRuntimeStateRef.current?.(sid); } catch { /* best effort */ }
    },
    onConnectionClosed: () => { /* nothing else to clean up at the moment */ },
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

  // Bridge the systemPrompt refresh out to the BTW panel's header refresh
  // button. AppShell triggers this via useSystemPromptRefresh(); without a
  // registered handler the button degrades to a no-op re-render.
  useEffect(() => {
    if (!isActive) return;
    setSystemPromptRefreshHandler(refreshSystemPrompt, sessionIdRef.current ?? undefined);
    return () => setSystemPromptRefreshHandler(null, sessionIdRef.current ?? undefined);
    // refreshSystemPrompt is a stable useCallback; isActive flips on tab
    // activation so we re-register the owner for the now-active session.
  }, [isActive, refreshSystemPrompt]);

  const { handleAgentEvent, applyRuntimeInput } = useAgentSessionEvents({
    controllerId: streamingKey,
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
  // The adapter's handler is stable (it reads its options through a ref), so
  // this bridge ref is only what breaks the cycle between the transport —
  // which owns the EventSource and therefore `closeEvents` — and the adapter,
  // which needs `closeEvents` to perform an effect.
  handleAgentEventRef.current = handleAgentEvent;
  applyRuntimeInputRef.current = applyRuntimeInput;

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    if (!message.trim() && !images?.length) return;
    if (isAgentRunning()) return;
    // New-session page with no cwd picked yet — can't create a session.
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
        // Remember the model actually being used so the next new session can
        // default to it instead of the global settings default.
        writeLastUsedModel({ provider: sendModel.provider, modelId: sendModel.modelId });
      }
      if (isNew && newSessionCwd) {
        const selectedModel = newSessionModel;
        if (selectedModel) setPendingModel(selectedModel);
        // Pass the user's selection through directly — `toolSelection` is
        // already in the wire shape `ToolSelection` (string[] | "all"), so
        // empty array = Off, "all" = High, partial = Custom.
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
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json() as { sessionId: string };
        const realId = result.sessionId;
        sessionIdRef.current = realId;
        connectEvents(realId);
        // The SSE connect can miss the very first agent_start (it fires while
        // the POST /api/agent/new is still in flight), so pull the system
        // prompt explicitly right after creation instead of waiting for
        // agent_end.
        refreshSystemPrompt();
        // Defer the sidebar refresh until the first assistant message lands:
        // the .jsonl does not exist before that, so a refresh right now would
        // not find the session. The event reducer clears this on the first
        // assistant `message_end` and asks the host to refresh exactly once.
        patchRuntime("awaitingFirstAssistant", true);
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
        });
      } else if (session) {
        await ensureEventsConnected(session.id);
        await sendAgentCommand(session.id, {
          type: "prompt",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      }
    } catch (e) {
      console.error("Failed to send message:", e);
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
  }, [isNew, newSessionCwd, newSessionModel, currentModel, toolSelection, runtimeState.thinkingLevel, session, closeEvents, connectEvents, ensureEventsConnected, isAgentRunning, onSessionCreated, patchRuntime, refreshSystemPrompt, setAgentPhase, setAgentRunningSync, setCompactingSync, setMessages, setRuntimeError, showToast, streamingKey, t]);

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
    // Sync the thinking level to whatever the freshly-selected model
    // actually supports. If the user's current level isn't in the new
    // model's available list (e.g. they had "medium" on a model that
    // supports low/medium/high, then switched to one that only
    // supports "high"), pi would silently clamp on the server side
    // and the UI would drift out of sync with what the agent is using
    // — or, on stricter providers, the next prompt call could error.
    //
    // - Existing sessions: walk to the closest available level (preserve
    //   the user's pick when possible).
    // - New sessions: no session exists yet, so the "user pick" is really
    //   the model-derived default — default new sessions to "off" so we
    //   don't waste tokens on extended thinking until the user opts in.
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
        // Push the clamped value to the live agent so the persisted
        // session state matches what the UI now shows. Pi would have
        // done this anyway on the next setModel — but that fires
        // asynchronously, and a prompt arriving in the gap would still
        // see the stale level. Doing it here closes that window.
        await sendAgentCommand(sid, { type: "set_thinking_level", level: nextLevel });
      } else if (newModelLevels === null) {
        // Unknown model (not in the thinkingLevels map): we couldn't clamp
        // locally, so resync the badge from the agent's actual state — pi
        // has already clamped server-side, and without this the UI would
        // keep showing a level the model doesn't support.
        try {
          const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
          const st = res.ok ? await res.json() as { state?: { thinkingLevel?: string } } : null;
          if (typeof st?.state?.thinkingLevel === "string") {
            setThinkingLevel(st.state.thinkingLevel as ThinkingLevelOption);
          }
        } catch {
          // Best-effort resync; keep the requested level on failure.
        }
      }
    } catch (e) {
      console.error("Failed to set model:", e);
      showToast({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to switch model") });
    }
  }, [isNew, modelThinkingLevels, runtimeState.thinkingLevel, setNewSessionModel, setThinkingLevel, showToast, t]);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    // Clamp to the current model's advertised levels before applying. When
    // the model isn't in the thinkingLevels map (unknown / not yet loaded)
    // we pass the pick through — pi clamps server-side and the runtime-state
    // resync paths keep the badge honest.
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

  // Apply a new tool selection. For existing sessions, the change is sent
  // straight to the agent (`set_tools`); for new sessions we only update
  // local state — the new selection is serialised into `toolNames` at
  // handleSend time so the brand-new session starts with the right set.
  // Errors are surfaced via toast (and the UI does NOT roll back the
  // optimistic local state — the user can retry).
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

  // Manual compaction lifecycle. Lives in the hook so all the related state
  // (busy flag, agentPhase, SSE subscription, post-RPC reload) is owned in
  // one place — the previous ChatWindow-local implementation relied on SSE
  // to refresh the UI, but idle sessions don't keep an EventSource open, so
  // the divider + tree card would never render until the user switched tabs.
  // This implementation:
  //   1. Refuses early if anything is already running (including compact) so
  //      a double-click can't dispatch two compactions in the same tick.
  //   2. Sets busy + phase synchronously (ref + state) so the toolbar
  //      disables, the input locks, and any subsequent click is a no-op.
  //   3. Ensures the SSE stream is open before posting — guarantees we
  //      receive compaction_start / compaction_end even if the request races
  //      a fresh chat session.
  //   4. On RPC success, unconditionally reloads from disk regardless of
  //      whether the SSE end event arrived (which can be lost on idle tabs
  //      whose EventSource hadn't been opened).
  //   5. Always clears busy state in `finally`, so a server rejection or
  //      network error doesn't strand the UI in "compacting" forever.
  // Manual compaction: empty-payload RPC. Compresses the visible message
  // path using the kernel's default summarization prompt. Mirrors the
  // `/compact` slash command in pi TUI (the optional `[focus]` tail was
  // dropped — there's no UI surface for it anymore).
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
        // Pi doesn't yet return token counts here — show a generic success
        // message until /api/sessions/[id] round-trips with fresh numbers.
        message: t("Compacted context"),
      });
      // Reload from disk so the visible message list, compaction divider,
      // and conversation-tree card all reflect the new compaction entry
      // even if the SSE compaction_end event was missed.
      await loadSession(sid);
    } catch (error) {
      console.error("Manual compact failed:", error);
      showToast({
        kind: "error",
        message: `${t("Compact failed")}: ${
          error instanceof Error && error.message ? error.message : t("Network error")
        }`,
      });
      // Refresh runtime state — if the server rejected because compaction
      // was already running, surface its real phase so the UI isn't stuck
      // on the optimistic "compacting" badge.
      try { await refreshAgentRuntimeState(sid); } catch { /* best-effort */ }
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

  // Load session on mount
  useEffect(() => {
    disposedRef.current = false;
    // A fresh mount means a fresh belief about the session: drop the dedupe
    // ledgers. The ledgers live in the runtime state object, so this is the
    // only place they need clearing (it used to clear three refs).
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
        // The REST snapshot is one more input to the one reducer.
        applyRuntimeInputRef.current({ type: "client_snapshot", snapshot: agentState });
        // Backstop for a wrapper that wasn't alive at includeState time (e.g.
        // right after server boot): GET /api/agent/[id] lazily boots the RPC
        // session, so one re-fetch publishes systemPrompt/contextUsage without
        // waiting for the user to hit the BTW panel's refresh button.
        if (agentState && !agentState.state) {
          refreshAgentRuntimeState(session.id).catch(() => {});
        }
        // Connect SSE whenever the wrapper is alive and reporting any kind
        // of busyness — streaming, compacting, or a generic "running" flag.
        // Without this, a page refresh in the middle of a manual compact
        // leaves the UI idle (no EventSource open) and silently drops the
        // compaction_end event that would have refreshed the chat stream.
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
        // thinkingLevel was already migrated + applied inside loadSession
        // (handles the legacy "auto" sentinel against the current model).
      });
    }
    return () => {
      disposedRef.current = true;
      closeEvents();
      // Runtime show-file results are keyed by globally unique toolCallId and
      // intentionally survive individual tab closes; clearing the shared map
      // here would erase the active tab's previews when a background tab closes.
      // The in-flight tool table lives in the runtime state object, which is
      // dropped with the mount — no defensive flush needed.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search results may target a controller that is already open. Handle the
  // prop change directly instead of relying on a ChatWindow remount/hydration.
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
      // Landing the view at the end of the reloaded branch (and reporting it
      // back to the shell) is a scroll concern: `useScrollFollow` owns it.
      onEntryNavigated?.();
    })();
  }, [loading, onEntryNavigated, scrollToEntryId, setActiveLeafId]);

  useEffect(() => {
    if (isActive) setSessionUiState({ systemPrompt });
  }, [isActive, systemPrompt]);

  useEffect(() => {
    if (isActive) {
      setSessionUiState({ branchTree: runtimeState.liveTree ?? data?.tree ?? [], branchActiveLeafId: runtimeState.activeLeafId });
    }
  }, [isActive, data?.tree, runtimeState.activeLeafId, runtimeState.liveTree]);

  // Keep the store's leaf-change handler owned by the active controller only.
  // Background controllers remain fully live, but must never redirect a branch
  // click from the visible session into their own conversation.
  useEffect(() => {
    if (!isActive) return;
    setLeafChangeHandler(handleLeafChange, controllerId);
    return () => setLeafChangeHandler(null, controllerId);
  }, [controllerId, isActive, handleLeafChange]);

  // Load model list
  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then((d: { models: Record<string, string>; modelList?: { id: string; name: string; provider: string; reasoning?: boolean; input?: string[]; contextWindow?: number; maxTokens?: number; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }[]; defaultModel?: { provider: string; modelId: string } | null; thinkingLevels?: Record<string, string[]>; thinkingLevelMaps?: Record<string, Record<string, string | null>>; modelIcons?: Record<string, string> }) => {
      setModelNames(d.models);
      if (d.modelIcons) setModelIcons(d.modelIcons);
      if (d.thinkingLevels) setModelThinkingLevels(d.thinkingLevels);
      if (d.thinkingLevelMaps) setModelThinkingLevelMaps(d.thinkingLevelMaps);
      if (d.modelList) {
        setModelList(d.modelList);
        if (isNew && d.modelList.length > 0) {
          // Prefer the model the user last used over the global default from
          // settings.json, matching the pre-pre-selection behaviour. Falls
          // back to the settings default, then to the first available model.
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
          // Seed the thinking level to "off" for new sessions. We previously
          // defaulted to the freshly-selected model's middle supported level,
          // but that burned tokens on extended thinking before the user opted
          // in, so the chat now starts with thinking disabled.
          setThinkingLevel("off");
        }
      }
    }).catch(() => {});
  }, [isNew, modelsRefreshKey, setNewSessionModel, setThinkingLevel]);

  // Publish the remaining session-level state to the store. The shallow-equal
  // guard inside setSessionUiState prevents re-rendering AppShell's top bar
  // when an IIFE-derived value (sessionStats) gets a new object identity but
  // the same scalar contents.
  useEffect(() => { if (isActive) setSessionUiState({ sessionStats }); }, [isActive, sessionStats]);
  useEffect(() => { if (isActive) setSessionUiState({ contextUsage: runtimeState.contextUsage }); }, [isActive, runtimeState.contextUsage]);
  useEffect(() => { if (isActive) setSessionUiState({ contextComposition: runtimeState.contextComposition }); }, [isActive, runtimeState.contextComposition]);
  useEffect(() => { if (isActive) setSessionUiState({ isStreaming: streamState.isStreaming }); }, [isActive, streamState.isStreaming]);
  // Publish the wider "agent is busy with this turn" flag so the
  // conversation-tree panel can lock card clicks for the entire turn,
  // not just the streaming sub-window. (See SessionUiState.agentRunning.)
  useEffect(() => { if (isActive) setSessionUiState({ agentRunning: runtimeState.agentRunning }); }, [isActive, runtimeState.agentRunning]);
  // Publish the active model + message transcript for cross-tab panels
  // (BTW reads both — `displayModel` to mirror the model and
  // `mainSessionMessages` to feed the BTW agent's first send with the
  // same context the user can see). The active-only filter mirrors the
  // other sessionUi fields; a background controller's messages must
  // never overwrite the visible chat's transcript.
  useEffect(() => { if (isActive) setSessionUiState({ currentModel: displayModel }); }, [isActive, displayModel]);
  useEffect(() => {
    if (isActive) setSessionUiState({ thinkingLevel: runtimeState.thinkingLevel, toolNames: toolSelection === "all" ? availableTools.map((tool) => tool.name) : toolSelection });
  }, [isActive, runtimeState.thinkingLevel, toolSelection, availableTools]);
  useEffect(() => { if (isActive) setSessionUiState({ mainSessionMessages: runtimeState.messages }); }, [isActive, runtimeState.messages]);

  // Clear a controller's pending bot reaction when it moves to the
  // background (and again on final unmount). Background events must not
  // repaint the active workspace's global sidebar companion.
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
    // State (projected out of the one session runtime state object)
    data, loading, error, entryIds, entryTimestamps, compactionPoints, inFlightToolResults, streamState,
    runtimeError: runtimeState.runtimeError,
    activeLeafId: runtimeState.activeLeafId,
    messages: runtimeState.messages,
    agentRunning: runtimeState.agentRunning,
    agentPhase: runtimeState.agentPhase,
    retryInfo: runtimeState.retryInfo,
    contextUsage: runtimeState.contextUsage,
    subagentRefreshKey: runtimeState.subagentRefreshKey,
    modelNames, modelIcons, modelList, modelThinkingLevels, modelThinkingLevelMaps, newSessionModel,
    toolSelection, availableTools, toolsLoading, toolsError,
    thinkingLevel: runtimeState.thinkingLevel,
    systemPrompt,
    currentModel, displayModel, sessionStats,
    isNew,
    currentSessionId,
    userMessageHistory,
    // Refs
    sessionIdRef, eventSourceRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef, userJustSentRef,
    // Actions
    handleSend, handleAbort, handleNavigate, handleModelChange,
    handleToolSelectionChange, ensureAvailableTools, handleThinkingLevelChange,
    handleCompact,
    setActiveLeafId, setData, setMessages,
    dispatch,
  };
}
