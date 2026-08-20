"use client";

import { useState, useCallback, useRef, useEffect, useReducer, useMemo } from "react";
import type { AgentMessage, SessionTreeNode, TextContent, ToolResultMessage, UserMessage, ToolInfo, ToolSelection, CompactionPoint } from "@/lib/shared/types";
import { sendAgentCommand } from "@/lib/client/agent-client";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "../useI18n";
import { usePendingPermissionsRef } from "../usePendingPermissions";
import { setSessionUiState, setLeafChangeHandler } from "../sessionUiStore";
import { pickClosestAvailableThinkingLevel, pickHighestAvailableThinkingLevel } from "@/lib/shared/thinking-level-utils";
import { streamReducer } from "./utils";
import { useAgentSessionEvents } from "./events";
import { useAgentSessionTransport } from "./transport";
import { useAgentSessionData } from "./data";
import type {
  AgentEvent,
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
    scrollToEntryId, onScrollComplete, isActive = true, controllerId,
  } = opts;
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
  const [liveTree, setLiveTree] = useState<SessionTreeNode[] | null>(null);
  // Only existing sessions load from disk — the new-session page (no session
  // yet, cwd possibly still being picked) must never sit in the loading
  // state, otherwise first entry would spin forever on "Loading session...".
  const [loading, setLoading] = useState(session !== null);
  const [error, setError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  // Parallel to entryIds: the entry-level persistence timestamp (ms) for each
  // message, when present. Feeds the per-turn duration display.
  const [entryTimestamps, setEntryTimestamps] = useState<(number | undefined)[]>([]);
  // Compaction points on the visible message path (see SessionContext.compactionPoints).
  // The chat list inserts a divider right before each point's first kept message.
  const [compactionPoints, setCompactionPoints] = useState<CompactionPoint[]>([]);
  // In-flight partial tool results keyed by toolCallId. Populated on
  // tool_execution_start, updated on each tool_execution_update (bash's
  // 100ms-throttled streaming output), and cleared on tool_execution_end.
  // ChatWindow overlays this map over the settled `messages` array so a
  // long-running bash command renders output as it streams, instead of
  // showing nothing until the final message_end lands.
  const [inFlightToolResults, setInFlightToolResults] = useState<Map<string, ToolResultMessage>>(
    () => new Map(),
  );
  // toolCallId → toolName scratchpad for the duration of a session. Populated
  // on tool_execution_start, consulted on tool_execution_end (the end event
  // doesn't carry the tool name, so we can't tell e.g. `show_file` apart from
  // `read` without this). The ref belongs to this tab controller.
  const toolCallNameRef = useRef<Map<string, string>>(new Map());
  // Parallel scratchpad for tool args, used to inspect bash command strings
  // on tool_execution_end (the end event doesn't carry args). Same
  // lifecycle as toolCallNameRef: populated on _start, consumed+cleared
  // on _end. It remains isolated to this tab controller.
  const toolCallArgsRef = useRef<Map<string, unknown>>(new Map());
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
  const [agentRunning, setAgentRunning] = useState(false);
  const [, setIsCompacting] = useState(false);
  const [agentTodoRefreshKey, setAgentTodoRefreshKey] = useState(0);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelIcons, setModelIcons] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModelState] = useState<{ provider: string; modelId: string } | null>(null);
  // The user's tool selection state. `[]` ≡ Off, `"all"` ≡ High (every
  // registered tool — sentinel so newly-added tools auto-include), a partial
  // string[] ≡ Custom. Only meaningful for new sessions — the tools popover
  // is hidden on existing-session pages (button gated on `isNew` in
  // ChatWindow), so the value for existing sessions is unused.
  const [toolSelection, setToolSelection] = useState<ToolSelection>(() => "all");
  // Catalog of every tool pi registered for this session's cwd. Populated
  // lazily: `ensureAvailableTools` on popover open for new sessions.
  // Sorted alphabetically by name when set.
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  // Fetch lifecycle for availableTools: spinner while in-flight, error string
  // surfaced to the UI. Cleared on every successful fetch.
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("off");
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const eventSourceSessionRef = useRef<string | null>(null);
  const transportGenerationRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const disposedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const agentRunningRef = useRef(false);
  const compactInFlightRef = useRef(false);
  const setAgentRunningSync = useCallback((running: boolean) => {
    agentRunningRef.current = running;
    setAgentRunning(running);
  }, []);
  const setCompactingSync = useCallback((compacting: boolean) => {
    setIsCompacting(compacting);
  }, []);
  // Holds the most recent assistant error message during a turn, so
  // agent_end can toast it. Cleared after the toast (or when the next
  // message_start arrives). auto_retry_end with success=false also
  // clears it to avoid double-toasting.
  const pendingAssistantErrorRef = useRef<string | null>(null);
  // Sidebar Pi Bot trigger (event-based, see Pi Bot Lab for visuals):
  //   lastAssistantIsBodyRef — the most recent assistant message in this
  //                            turn had text content with no toolUse;
  //                            agent_end uses this to pick happy vs
  //                            waking. Reset in agent_start so each turn
  //                            starts fresh. Tool failures are NOT tracked
  //                            here: a tool failure triggers "suspicious"
  //                            on the spot (with its own 8s revert), but
  //                            it must not suppress the final happy/waking
  //                            reaction at agent_end — a turn can recover
  //                            from a failed tool and end with a clean
  //                            body-text response, and the bot should
  //                            reflect that.
  const lastAssistantIsBodyRef = useRef(false);
  // setTimeout handle for the bot's revert-to-baseline timer. Cancel on
  // every new discrete trigger so the latest reaction always gets the
  // full BOT_REVERT_MS window. Cleared on unmount so a stale timer from
  // an unmounted session can't snap the sidebar bot to "searching".
  const botRevertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);
  // Set when POST /api/agent/new returns for a brand-new session. Cleared on
  // the first assistant message_end — pi persists the .jsonl lazily at that
  // moment (openSync "wx" in SessionManager._persist), which is the earliest
  // point the session becomes listable by the sidebar.
  const pendingNewSessionFirstAssistantRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const handledScrollEntryRef = useRef<string | null>(null);
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
    for (const m of messages) {
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
  }, [messages]);
  const currentSessionId: string | null = data?.sessionId ?? sessionIdRef.current ?? null;

  const sessionStats = (() => {
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let cost = 0;
    for (const msg of messages) {
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
    agentRunning: agentRunningRef,
  };
  const loadContextRef = useRef<(sid: string, leafId: string | null) => Promise<void>>(async () => {});
  const refreshAgentRuntimeStateRef = useRef<((sid?: string) => Promise<AgentRuntimeState | null>) | null>(null);
  const {
    loadSession,
    loadContext: loadContextBound,
    ensureAvailableTools: ensureAvailableToolsImpl,
    applyAgentRuntimeState,
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
    setContextUsage,
    setSystemPrompt,
    setAgentPhase,
    setAgentRunningSync,
    setCompactingSync,
    dispatch,
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

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

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

  const { handleAgentEventRef: eventHandlerRef } = useAgentSessionEvents({
    isActive,
    session,
    newSessionCwd,
    onAgentEnd,
    onFirstAssistantReady,
    permissionsRef,
    statsEmitRef,
    sessionIdRef,
    agentRunningRef,
    toolCallNameRef,
    toolCallArgsRef,
    pendingAssistantErrorRef,
    lastAssistantIsBodyRef,
    botRevertTimerRef,
    pendingNewSessionFirstAssistantRef,
    refreshSystemPrompt,
    loadSession,
    refreshAgentRuntimeStateRef,
    closeEvents,
    setRuntimeError,
    setAgentRunningSync,
    setCompactingSync,
    setRetryInfo,
    setAgentPhase,
    dispatch,
    setMessages,
    setLiveTree,
    setActiveLeafId,
    setInFlightToolResults,
    setAgentTodoRefreshKey,
    setContextUsage,
    setThinkingLevel,
    compactInFlightRef,
    showToast,
    t,
  });
  handleAgentEventRef.current = eventHandlerRef.current;

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    if (!message.trim() && !images?.length) return;
    if (agentRunningRef.current) return;
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
    pendingScrollToUserRef.current = true;
    userJustSentRef.current = true;

    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));

    try {
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
            thinkingLevel,
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
        // not find the session.
        pendingNewSessionFirstAssistantRef.current = true;
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
      closeEvents();
    }
  }, [isNew, newSessionCwd, newSessionModel, toolSelection, thinkingLevel, session, closeEvents, connectEvents, ensureEventsConnected, onSessionCreated, refreshSystemPrompt, setAgentRunningSync, setCompactingSync, showToast, t]);

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
  }, [loadContext]);

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    setActiveLeafId(leafId);
    const sid = sessionIdRef.current;
    if (!sid) return;
    await loadContext(sid, leafId);
    if (leafId) {
      sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId }).catch(() => {});
    }
  }, [loadContext]);

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
    //   the model-derived default — jump straight to the new model's
    //   highest supported level so the displayed default always matches
    //   the selected model.
    const newModelLevels = modelThinkingLevels[`${provider}:${modelId}`] ?? null;
    const nextLevel = isNew
      ? pickHighestAvailableThinkingLevel(newModelLevels)
      : pickClosestAvailableThinkingLevel(thinkingLevel, newModelLevels);
    const levelChanged = nextLevel !== thinkingLevel;
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
      }
    } catch (e) {
      console.error("Failed to set model:", e);
      showToast({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to switch model") });
    }
  }, [isNew, modelThinkingLevels, thinkingLevel, setNewSessionModel, showToast, t]);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    setThinkingLevel(level);
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
      showToast({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to change thinking level") });
    }
  }, [showToast, t]);

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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
  }, []);

  const scrollUserMsgToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
  }, []);

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
    if (agentRunningRef.current || compactInFlightRef.current) {
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
      if (!agentRunningRef.current) {
        setAgentRunningSync(false);
        setAgentPhase(null);
        closeEvents();
      }
    }
  }, [
    closeEvents,
    ensureEventsConnected,
    loadSession,
    refreshAgentRuntimeState,
    setAgentRunningSync,
    setCompactingSync,
    showToast,
    t,
  ]);

  // Load session on mount
  useEffect(() => {
    disposedRef.current = false;
    if (session) {
      sessionIdRef.current = session.id;
      loadSession(session.id, true, true).then(async (agentState) => {
        if (disposedRef.current) return;
        applyAgentRuntimeState(agentState);
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
      // toolCallNameRef.current is read here only as a defensive flush; the
      // ref is component-scoped and disappears with the next mount anyway.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      toolCallNameRef.current.clear();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      toolCallArgsRef.current.clear();
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
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      onScrollComplete?.();
    })();
  }, [loading, onScrollComplete, scrollToEntryId]);

  useEffect(() => {
    if (isActive) setSessionUiState({ systemPrompt });
  }, [isActive, systemPrompt]);

  useEffect(() => {
    if (isActive) {
      setSessionUiState({ branchTree: liveTree ?? data?.tree ?? [], branchActiveLeafId: activeLeafId });
    }
  }, [isActive, data?.tree, activeLeafId, liveTree]);

  // Keep the store's leaf-change handler owned by the active controller only.
  // Background controllers remain fully live, but must never redirect a branch
  // click from the visible session into their own conversation.
  useEffect(() => {
    if (!isActive) return;
    setLeafChangeHandler(handleLeafChange, controllerId);
    return () => setLeafChangeHandler(null, controllerId);
  }, [controllerId, isActive, handleLeafChange]);

  useEffect(() => {
    if (messages.length > 0) {
      if (pendingScrollToUserRef.current) {
        pendingScrollToUserRef.current = false;
        initialScrollDoneRef.current = true;
        scrollUserMsgToTop();
      } else if (!initialScrollDoneRef.current) {
        initialScrollDoneRef.current = true;
        scrollToBottom("instant");
      }
    }
  }, [messages.length, scrollToBottom, scrollUserMsgToTop]);

  // Load model list
  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then((d: { models: Record<string, string>; modelList?: { id: string; name: string; provider: string }[]; defaultModel?: { provider: string; modelId: string } | null; thinkingLevels?: Record<string, string[]>; thinkingLevelMaps?: Record<string, Record<string, string | null>>; modelIcons?: Record<string, string> }) => {
      setModelNames(d.models);
      if (d.modelIcons) setModelIcons(d.modelIcons);
      if (d.thinkingLevels) setModelThinkingLevels(d.thinkingLevels);
      if (d.thinkingLevelMaps) setModelThinkingLevelMaps(d.thinkingLevelMaps);
      if (d.modelList) {
        setModelList(d.modelList);
        if (isNew && d.modelList.length > 0) {
          const def = d.defaultModel;
          const match = def && d.modelList.find((m) => m.id === def.modelId && m.provider === def.provider);
          const selected = match
            ? { provider: match.provider, modelId: match.id }
            : { provider: d.modelList[0].provider, modelId: d.modelList[0].id };
          setNewSessionModel(selected);
          // Seed the thinking level to the freshly-selected model's highest
          // supported level. Models without reasoning capability report
          // ["off"] only, which pickHighestAvailableThinkingLevel returns as-is.
          const available = d.thinkingLevels?.[`${selected.provider}:${selected.modelId}`] ?? null;
          setThinkingLevel(pickHighestAvailableThinkingLevel(available));
        }
      }
    }).catch(() => {});
  }, [isNew, modelsRefreshKey, setNewSessionModel]);

  // Publish the remaining session-level state to the store. The shallow-equal
  // guard inside setSessionUiState prevents re-rendering AppShell's top bar
  // when an IIFE-derived value (sessionStats) gets a new object identity but
  // the same scalar contents.
  useEffect(() => { if (isActive) setSessionUiState({ sessionStats }); }, [isActive, sessionStats]);
  useEffect(() => { if (isActive) setSessionUiState({ contextUsage }); }, [isActive, contextUsage]);
  useEffect(() => { if (isActive) setSessionUiState({ isStreaming: streamState.isStreaming }); }, [isActive, streamState.isStreaming]);
  // Publish the wider "agent is busy with this turn" flag so the
  // conversation-tree panel can lock card clicks for the entire turn,
  // not just the streaming sub-window. (See SessionUiState.agentRunning.)
  useEffect(() => { if (isActive) setSessionUiState({ agentRunning }); }, [isActive, agentRunning]);

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
  }, []);

  return {
    // State
    data, loading, error, runtimeError, activeLeafId, messages, entryIds, entryTimestamps, compactionPoints, inFlightToolResults, streamState,
    agentRunning, modelNames, modelIcons, modelList, modelThinkingLevels, modelThinkingLevelMaps, newSessionModel,
    toolSelection, availableTools, toolsLoading, toolsError,
    thinkingLevel,
    retryInfo, contextUsage, systemPrompt,
    currentModel, displayModel, sessionStats,
    agentPhase,
    agentTodoRefreshKey,
    isNew,
    currentSessionId,
    userMessageHistory,
    // Refs
    sessionIdRef, eventSourceRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef, initialScrollDoneRef, userJustSentRef,
    // Actions
    handleSend, handleAbort, handleNavigate, handleModelChange,
    handleToolSelectionChange, ensureAvailableTools, handleThinkingLevelChange,
    handleCompact,
    setActiveLeafId, setData, setMessages,
    dispatch, setAgentRunning,
    // Subscriptions
    handleAgentEventRef,
  };
}
