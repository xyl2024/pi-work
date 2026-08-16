"use client";

import { useState, useCallback, useRef, useEffect, useReducer, useMemo } from "react";
import type { AgentMessage, SessionInfo, SessionTreeNode, TextContent, ToolResultMessage, UserMessage, ToolInfo, ToolSelection } from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { sendAgentCommand, listToolsForCwd, type ToolWithActive } from "@/lib/agent-client";
import type { ToolCallStatsDispatch } from "./ToolCallStatsContext";
import { useToast } from "@/components/Toast";
import { useI18n } from "./useI18n";
import { usePendingPermissionsRef } from "./usePendingPermissions";
import { setShowFileResult, resetShowFileResults } from "./showFileResultsStore";
import { isShowFileToolName } from "@/lib/show-file-tool-types";
import { setSessionUiState, setLeafChangeHandler } from "./sessionUiStore";
import { setGrokbotConfig } from "@/lib/grokbot-store";
import { pickClosestAvailableThinkingLevel, pickHighestAvailableThinkingLevel } from "@/lib/thinking-level-utils";
import { setPendingAskUserQuestions } from "./askUserQuestionsStore";
import type { AskUserQuestion } from "@/lib/ask-user-questions-tool-types";

// Sidebar Pi Bot: discrete reactions (waking/suspicious/happy) only
// flash for BOT_REVERT_MS, then snap back to the daily "searching" loop.
// Long enough for each state's cadence to swap expressions 2–3 times
// (cadences range from 0.8s for waking up to 4.5s for happy), short
// enough that the bot doesn't feel stuck on a reaction between turns.
const BOT_BASELINE_STATE = "searching";
const BOT_REVERT_MS = 8000;

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    entryTimestamps?: (number | undefined)[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "update":
      return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset":
      return { isStreaming: false, streamingMessage: null };
    default:
      return state;
  }
}

interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | null;

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  /** Fired once, when the first assistant message of a brand-new session has
   *  been persisted (pi lazily creates the .jsonl at that point). The sidebar
   *  uses this to refresh at the earliest moment the session is listable. */
  onFirstAssistantReady?: () => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  setNewSessionModel?: (model: { provider: string; modelId: string } | null) => void;
  /** Push tool lifecycle events to the stats panel */
  statsEmit?: ToolCallStatsDispatch;
  /** If set, navigate to this entry after the session finishes loading */
  scrollToEntryId?: string | null;
  /** Called after the scroll-to-entry navigation completes */
  onScrollComplete?: () => void;
}

export type ThinkingLevelOption = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  addImages: (files: File[]) => void;
}

export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  addImages: (files: File[]) => void;
}

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session, newSessionCwd, onAgentEnd, onSessionCreated, onFirstAssistantReady,
    modelsRefreshKey, statsEmit,
    scrollToEntryId, onScrollComplete,
  } = opts;
  const { t } = useI18n();
  const toast = useToast();
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
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  // Parallel to entryIds: the entry-level persistence timestamp (ms) for each
  // message, when present. Feeds the per-turn duration display.
  const [entryTimestamps, setEntryTimestamps] = useState<(number | undefined)[]>([]);
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
  // `read` without this). Component-scope, so a session remount resets it.
  const toolCallNameRef = useRef<Map<string, string>>(new Map());
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
  const [agentRunning, setAgentRunning] = useState(false);
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
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const agentRunningRef = useRef(false);
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
  const scrollToEntryIdRef = useRef(scrollToEntryId);
  scrollToEntryIdRef.current = scrollToEntryId;
  const onScrollCompleteRef = useRef(onScrollComplete);
  onScrollCompleteRef.current = onScrollComplete;
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
      const u = (msg as import("@/lib/types").AssistantMessage).usage;
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

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false) => {
    try {
      if (showLoading) setLoading(true);
      const url = includeState
        ? `/api/sessions/${encodeURIComponent(sid)}?includeState`
        : `/api/sessions/${encodeURIComponent(sid)}`;
      const res = await fetch(url);
      if (res.status === 404) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setError(null);
        }
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData & { agentState?: { running: boolean; state?: { isStreaming?: boolean; contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null; systemPrompt?: string; thinkingLevel?: string } } };
      setData(d);
      // data.tree is now authoritative (fresh from disk); drop any live tree
      // pushed during the previous streaming window so it can't go stale.
      setLiveTree(null);
      setActiveLeafId(d.leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setEntryTimestamps(d.context.entryTimestamps ?? []);
      setCurrentModelOverride(null);
      setError(null);
      // Helper: pick the highest thinking level the current model supports, or
      // fall back to the raw value if it isn't the legacy "auto" sentinel.
      // Older sessions may persist "auto" — a frontend-only sentinel that
      // is no longer offered — so map it to the model's highest level so
      // the badge matches what the agent is actually using.
      const migrateLegacyAuto = (raw: string | undefined): ThinkingLevelOption | null => {
        if (typeof raw !== "string") return null;
        if (raw !== "auto") return raw as ThinkingLevelOption;
        const modelKey = d.context.model
          ? `${d.context.model.provider}:${d.context.model.modelId}`
          : null;
        const available = modelKey ? modelThinkingLevels[modelKey] ?? null : null;
        return pickHighestAvailableThinkingLevel(available);
      };

      // Apply thinking-level migration centrally: prefer the live agent
      // state when present, else fall back to the level recorded in the
      // session file. Older sessions may persist "auto" — map it to the
      // model's highest supported level so the badge always matches the
      // agent's actual setting.
      const liveLevel = d.agentState?.state?.thinkingLevel;
      const fileLevel = d.context.thinkingLevel && d.context.thinkingLevel !== "off"
        ? d.context.thinkingLevel
        : null;
      const migrated = migrateLegacyAuto(liveLevel ?? fileLevel ?? undefined);
      if (migrated !== null) setThinkingLevel(migrated);

      return d.agentState ?? null;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [modelThinkingLevels]);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    try {
      const url = leafId
        ? `/api/sessions/${encodeURIComponent(sid)}/context?leafId=${encodeURIComponent(leafId)}`
        : `/api/sessions/${encodeURIComponent(sid)}/context`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { context: { messages: AgentMessage[]; entryIds: string[]; entryTimestamps?: (number | undefined)[] } };
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setEntryTimestamps(d.context.entryTimestamps ?? []);
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }, []);

  const loadContextRef = useRef(loadContext);
  loadContextRef.current = loadContext;

  // Lazy fetcher for the tool catalog: called by ChatInput when the user
  // opens the tools popover for the first time. New sessions don't have an
  // AgentSession yet (they're lazily started by POST /api/agent/new), so
  // we can't use `get_tools` for them — fall back to the cwd-only endpoint
  // POST /api/agent/tools which spins up an ephemeral session internally.
  // Idempotent: if the catalog is already populated, do nothing.
  const ensureAvailableTools = useCallback(async () => {
    if (availableTools.length > 0 || toolsLoading) return;
    setToolsLoading(true);
    setToolsError(null);
    try {
      let catalog: ToolInfo[];
      if (isNew) {
        if (!newSessionCwd) {
          throw new Error("No cwd available for new session");
        }
        catalog = await listToolsForCwd(newSessionCwd);
      } else {
        const sid = sessionIdRef.current;
        if (!sid) throw new Error("No session id");
        const tools = await sendAgentCommand<ToolWithActive[]>(sid, { type: "get_tools" });
        catalog = tools.map(({ name, description }) => ({ name, description }));
      }
      catalog.sort((a, b) => a.name.localeCompare(b.name));
      setAvailableTools(catalog);
    } catch (e) {
      console.error("Failed to ensure available tools:", e);
      setToolsError(e instanceof Error ? e.message : String(e));
    } finally {
      setToolsLoading(false);
    }
  }, [availableTools.length, toolsLoading, isNew, newSessionCwd]);

  const connectEvents = useCallback((sid: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    const es = new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`);
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AgentEvent;
        handleAgentEventRef.current?.(event);
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      if (eventSourceRef.current === es && agentRunningRef.current) {
        es.close();
        eventSourceRef.current = null;
        setTimeout(() => {
          if (agentRunningRef.current) connectEvents(sid);
        }, 1000);
      }
    };
  }, []);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  // System prompt is runtime-only agent state (never persisted to the .jsonl),
  // so the top bar can only show it while the RPC wrapper is alive. Pull it at
  // every turn start (agent_start) instead of waiting for agent_end, and again
  // right after a brand-new session is created (the SSE connect can miss the
  // very first agent_start). GET /api/agent/[id] is a cheap get_state and
  // returns { running: false } without a state when the wrapper is gone.
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

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    // Sidebar Pi Bot helpers, scoped to this callback so the timer ref
    // stays a stable capture without enlarging the useCallback dep list.
    // fireDiscreteBot cancels any pending revert and schedules a fresh
    // BOT_REVERT_MS timer to snap back to the daily "searching" loop.
    // setBaselineBot cancels the timer and pins the bot to searching
    // immediately (used on agent_start so a new turn never inherits a
    // stale reaction state).
    const fireDiscreteBot = (stateKey: string) => {
      if (botRevertTimerRef.current !== null) {
        clearTimeout(botRevertTimerRef.current);
        botRevertTimerRef.current = null;
      }
      setGrokbotConfig({ stateKey });
      botRevertTimerRef.current = setTimeout(() => {
        botRevertTimerRef.current = null;
        setGrokbotConfig({ stateKey: BOT_BASELINE_STATE });
      }, BOT_REVERT_MS);
    };
    const setBaselineBot = () => {
      if (botRevertTimerRef.current !== null) {
        clearTimeout(botRevertTimerRef.current);
        botRevertTimerRef.current = null;
      }
      setGrokbotConfig({ stateKey: BOT_BASELINE_STATE });
    };

    switch (event.type) {
      case "agent_start":
        setAgentRunning(true);
        setAgentPhase({ kind: "waiting_model" });
        dispatch({ type: "start" });
        statsEmitRef.current?.({ type: "reset" });
        refreshSystemPrompt();
        // Reset per-turn Pi Bot trigger refs so each turn's happy/waking
        // decision starts from a clean slate. Also snap the sidebar bot
        // back to the daily "searching" loop right away so the user sees
        // the bot actively working for the new turn.
        lastAssistantIsBodyRef.current = false;
        setBaselineBot();
        break;
      case "agent_end":
        setAgentRunning(false);
        setAgentPhase(null);
        setRetryInfo(null);
        dispatch({ type: "end" });
        // Surface the final assistant error (if any) after retries gave up
        // — auto_retry_end already toasts the same error on the success:false
        // path, so the ref is normally null here.
        if (pendingAssistantErrorRef.current) {
          toast.show({ kind: "error", message: pendingAssistantErrorRef.current });
          pendingAssistantErrorRef.current = null;
        }
        // Pi Bot trigger: stream is over. Pick happy if the last assistant
        // message is body text; otherwise waking (default for tool-call-
        // only turns, model errors, user aborts, etc.). Tool failures
        // already flashed "suspicious" earlier in the turn — they do NOT
        // suppress this final reaction, since a turn can recover from a
        // failed tool and end with a clean body-text response. Each
        // reaction auto-reverts to "searching" after BOT_REVERT_MS via
        // the timer set in fireDiscreteBot.
        fireDiscreteBot(lastAssistantIsBodyRef.current ? "happy" : "waking");
        if (sessionIdRef.current) {
          loadSession(sessionIdRef.current);
          fetch(`/api/agent/${encodeURIComponent(sessionIdRef.current)}`)
            .then((r) => r.json())
            .then((d: { state?: { contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null; systemPrompt?: string } }) => {
              if (d.state?.contextUsage !== undefined) setContextUsage(d.state.contextUsage ?? null);
              if (d.state?.systemPrompt !== undefined) setSystemPrompt(d.state.systemPrompt ?? null);
            })
            .catch(() => {});
        }
        onAgentEnd?.();
        break;
      case "message_start":
      case "message_update": {
        const msg = event.message as Partial<AgentMessage> | undefined;
        // User messages are added optimistically by handleSend.
        // Skip SSE events for user messages to avoid double-display during streaming.
        if (msg && msg.role !== "user") {
          dispatch({ type: "update", message: normalizeToolCalls(msg as AgentMessage) });
        }
        setAgentPhase(null);
        break;
      }
      case "message_end": {
        const completed = event.message as AgentMessage | undefined;
        // User messages are added optimistically by handleSend.
        // Skip appending from SSE to avoid duplication.
        if (completed && completed.role !== "user") {
          setMessages((prev) => [...prev, normalizeToolCalls(completed)]);
        }
        // First assistant message of a brand-new session → pi has lazily
        // persisted the .jsonl by now, so the sidebar can finally list it.
        if (completed?.role === "assistant" && pendingNewSessionFirstAssistantRef.current) {
          pendingNewSessionFirstAssistantRef.current = false;
          onFirstAssistantReady?.();
        }
        dispatch({ type: "reset" });
        setAgentPhase({ kind: "waiting_model" });
        // Capture assistant errors for the upcoming agent_end toast. During
        // retries the SDK emits a fresh message_end per attempt; only the
        // last one wins, which is what we want for the final toast.
        if (completed?.role === "assistant" && completed.stopReason === "error") {
          pendingAssistantErrorRef.current = completed.errorMessage ?? "Model call failed";
        }
        // Pi Bot trigger: remember whether the most recent assistant
        // message is "body" (text, no toolUse). agent_end uses this to
        // pick happy vs waking. Track on every assistant message_end so
        // the last one wins, mirroring how pendingAssistantErrorRef
        // captures the last failure across retries.
        if (completed?.role === "assistant") {
          lastAssistantIsBodyRef.current = isBodyMessage(completed);
        }
        // Refresh context usage after each assistant message so the progress
        // bar tracks every model API call, not just turn end.
        if (completed?.role === "assistant" && sessionIdRef.current) {
          fetch(`/api/agent/${encodeURIComponent(sessionIdRef.current)}`)
            .then((r) => r.json())
            .then((d: { state?: { contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null } }) => {
              if (d.state?.contextUsage !== undefined) setContextUsage(d.state.contextUsage ?? null);
            })
            .catch(() => {});
        }
        break;
      }
      // Server-pushed live conversation tree (after every message_end, and
      // once on SSE connect). Keeps the conversation-tree panel rendering
      // new cards as soon as pi persists each message — no wait for the
      // whole turn (agent_end) to finish.
      case "session_tree_update": {
        const tree = event.tree;
        const leafId = event.leafId;
        if (Array.isArray(tree)) setLiveTree(tree as SessionTreeNode[]);
        if (typeof leafId === "string") setActiveLeafId(leafId);
        break;
      }
      case "tool_execution_start": {
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        const args = event.args;
        toolCallNameRef.current.set(id, name);
        statsEmitRef.current?.({
          type: "tool_start",
          toolCallId: id,
          toolName: name,
          timestamp: Date.now(),
          args: args && typeof args === "object" && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : undefined,
        });
        // Seed an empty in-flight placeholder so the UI can render streaming
        // output (tool_execution_update events) even before the first chunk
        // arrives. Cleared on tool_execution_end.
        setInFlightToolResults((prev) => {
          if (prev.has(id)) return prev;
          const next = new Map(prev);
          next.set(id, {
            role: "toolResult",
            toolCallId: id,
            toolName: name,
            content: [],
            timestamp: Date.now(),
          });
          return next;
        });
        setAgentPhase((prev) => {
          const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
          if (!tools.some((t) => t.id === id)) tools.push({ id, name });
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "tool_execution_update": {
        // Pi throttles tool onUpdate calls to 100ms (10Hz); partialResult.content
        // is the accumulated snapshot, not a delta, so we just replace the
        // in-flight entry's content. Empty updates (e.g. the initial empty
        // onUpdate from bash right after spawn) are a no-op.
        const id = event.toolCallId as string;
        const partial = event.partialResult as
          | { content?: Array<{ type?: string; text?: string }>; details?: unknown }
          | undefined;
        if (!id || !partial || !Array.isArray(partial.content)) break;
        const content: TextContent[] = [];
        for (const b of partial.content) {
          if (b && b.type === "text" && typeof b.text === "string") {
            content.push({ type: "text", text: b.text });
          }
        }
        if (content.length === 0) break;
        setInFlightToolResults((prev) => {
          const existing = prev.get(id);
          if (!existing) return prev; // no start event yet — drop
          const next = new Map(prev);
          next.set(id, { ...existing, content });
          return next;
        });
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId as string;
        const isError = event.isError === true;
        // Pi Bot trigger: a failing tool flips the sidebar bot to
        // "suspicious" for BOT_REVERT_MS, then snaps back to "searching".
        // Independent of the final happy/waking reaction at agent_end, so
        // a turn that recovers from a tool failure still gets to celebrate.
        if (isError) {
          fireDiscreteBot("suspicious");
        }
        const result = event.result as { content?: Array<{ type?: string; text?: string }>; details?: unknown } | undefined;
        // Capture show_file results into the Session Library cache so the
        // modal can render success / failure states correctly. The runtime
        // cache is module-scoped so it survives ChatWindow re-renders but
        // is reset on session switches (see below).
        const toolNameForEnd = toolCallNameRef.current.get(id);
        if (toolNameForEnd && isShowFileToolName(toolNameForEnd) && result?.details) {
          const files = (result.details as { files?: unknown }).files;
          if (Array.isArray(files)) {
            setShowFileResult(
              id,
              files as Parameters<typeof setShowFileResult>[1],
            );
          }
        }
        let resultText: string | undefined;
        if (result && Array.isArray(result.content)) {
          const firstText = result.content.find((c) => c?.type === "text" && typeof c.text === "string");
          if (firstText && typeof firstText.text === "string") {
            resultText = firstText.text.length > 1024
              ? firstText.text.slice(0, 1024) + "…"
              : firstText.text;
          }
        }
        statsEmitRef.current?.({
          type: "tool_end",
          toolCallId: id,
          isError,
          timestamp: Date.now(),
          resultText,
          resultDetails: result?.details,
        });
        // Drop the in-flight placeholder. The final toolResult message will
        // arrive via the subsequent message_start + message_end events and
        // render from the settled `messages` array.
        setInFlightToolResults((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        toolCallNameRef.current.delete(id);
        setAgentPhase((prev) => {
          if (prev?.kind !== "running_tools") return prev;
          const tools = prev.tools.filter((t) => t.id !== id);
          if (tools.length === 0) return { kind: "waiting_model" };
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "auto_retry_start":
        setRetryInfo({ attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined });
        break;
      case "prompt_failed": {
        // Emitted by rpc-manager when the inner prompt() rejects (missing
        // API key, unregistered model, etc.) before agent_start fires.
        // Reset local running state so the UI isn't stuck mid-turn.
        setAgentRunning(false);
        setAgentPhase(null);
        setRetryInfo(null);
        dispatch({ type: "end" });
        const msg = event.error as string | undefined;
        toast.show({ kind: "error", message: msg || t("Failed to send message") });
        break;
      }
      case "auto_retry_end":
        setRetryInfo(null);
        // Exhausted retries (or non-retryable failure during a retry chain):
        // the SDK has already finalised the failure here, so toast the
        // finalError and clear the pending-error ref so agent_end doesn't
        // double-toast.
        if (event.success === false) {
          const finalError = event.finalError as string | undefined;
          if (finalError) {
            toast.show({ kind: "error", message: finalError });
            pendingAssistantErrorRef.current = null;
          }
        }
        break;
      case "permission_request": {
        const sid = sessionIdRef.current;
        if (!sid) break;
        permissionsRef.current?.addRequest({
          toolCallId: event.toolCallId as string,
          ruleName: event.ruleName as string,
          command: event.command as string,
          sessionId: sid,
        });
        break;
      }
      // ask_user_questions: agent wants to block on user input. Push the
      // questions into the module-scoped store; the sticky panel and
      // sidebar dot read from there.
      case "ask_user_questions_request": {
        const sid = sessionIdRef.current;
        if (!sid) break;
        const questions = event.questions;
        const toolCallId = event.toolCallId;
        if (typeof toolCallId !== "string" || !Array.isArray(questions)) break;
        // Defensive: drop the event if the payload is malformed rather than
        // handing garbage to the panel — the tool's server-side wrapper
        // already validated, but a buggy SDK could still send odd shapes.
        const validQuestions: AskUserQuestion[] = [];
        for (const q of questions) {
          if (
            q &&
            typeof q.question === "string" &&
            typeof q.header === "string" &&
            typeof q.multiSelect === "boolean" &&
            typeof q.required === "boolean" &&
            Array.isArray(q.options)
          ) {
            validQuestions.push(q as AskUserQuestion);
          }
        }
        if (validQuestions.length === 0) break;
        setPendingAskUserQuestions(sid, {
          toolCallId,
          questions: validQuestions,
          ts: typeof event.ts === "number" ? event.ts : Date.now(),
        });
        break;
      }
      // Compaction is kernel-driven now (manual trigger was removed); keep
      // refreshing so the UI tracks the file after an auto-compaction, and
      // surface failures that used to show next to the compact button.
      case "compaction_end":
      case "auto_compaction_end":
        if (event.errorMessage) {
          toast.show({ kind: "error", message: event.errorMessage as string });
        } else if (!event.aborted) {
          if (sessionIdRef.current) loadSession(sessionIdRef.current);
        }
        break;
      // Pi re-emits this whenever the agent's thinking level actually
      // changes — including the implicit clamp that fires inside
      // `setModel` when the new model doesn't support the previous
      // level. Without this handler the UI would silently drift away
      // from the agent's real setting after a model switch (or any
      // other server-side clamp), and the next prompt would either
      // race the clamp or carry a stale level. Treat the SDK as the
      // source of truth and mirror whatever level it reports.
      case "thinking_level_changed": {
        const level = event.level;
        if (typeof level === "string") {
          setThinkingLevel(level as ThinkingLevelOption);
        }
        break;
      }
    }
  }, [loadSession, onAgentEnd, onFirstAssistantReady, permissionsRef, refreshSystemPrompt, t, toast]);
  handleAgentEventRef.current = handleAgentEvent;

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    if (!message.trim() && !images?.length) return;
    if (agentRunning) return;
    // New-session page with no cwd picked yet — can't create a session.
    if (isNew && !newSessionCwd) {
      toast.show({ kind: "error", message: t("Select a project first") });
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
    setAgentRunning(true);
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
        connectEvents(session.id);
        await sendAgentCommand(session.id, {
          type: "prompt",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      toast.show({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to send message") });
      setAgentRunning(false);
      setAgentPhase(null);
      dispatch({ type: "end" });
    }
  }, [isNew, newSessionCwd, newSessionModel, toolSelection, thinkingLevel, session, agentRunning, connectEvents, onSessionCreated, refreshSystemPrompt, t, toast]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
      toast.show({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to stop agent") });
    }
  }, [t, toast]);

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
      if (levelChanged) {
        toast.show({
          kind: "info",
          message: t("Thinking level adjusted to {level} for the new model", { level: nextLevel }),
        });
      }
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
        toast.show({
          kind: "info",
          message: t("Thinking level adjusted to {level} for the new model", { level: nextLevel }),
        });
      }
    } catch (e) {
      console.error("Failed to set model:", e);
      toast.show({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to switch model") });
    }
  }, [isNew, modelThinkingLevels, thinkingLevel, setNewSessionModel, t, toast]);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    setThinkingLevel(level);
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
      toast.show({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to change thinking level") });
    }
  }, [t, toast]);

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
      toast.show({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to change tools") });
    }
  }, [t, toast]);

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

  // Load session on mount
  useEffect(() => {
    if (session) {
      sessionIdRef.current = session.id;
      loadSession(session.id, true, true).then(async (agentState) => {
        if (agentState?.running) {
          if (agentState.state?.isStreaming) {
            setAgentRunning(true);
            setAgentPhase({ kind: "waiting_model" });
            connectEvents(session.id);
          }
        }
        if (agentState?.state) {
          if (agentState.state.contextUsage !== undefined) setContextUsage(agentState.state.contextUsage ?? null);
          if (agentState.state.systemPrompt !== undefined) setSystemPrompt(agentState.state.systemPrompt ?? null);
          // thinkingLevel was already migrated + applied inside loadSession
          // (handles the legacy "auto" sentinel against the current model).
        }

        // If a specific entry was requested via search, navigate to it
        const targetEntryId = scrollToEntryIdRef.current;
        if (targetEntryId) {
          setActiveLeafId(targetEntryId);
          await loadContextRef.current(session.id, targetEntryId);
          sendAgentCommand(session.id, { type: "navigate_tree", targetId: targetEntryId }).catch(() => {});
          // Scroll to the matched message after React commits the new messages
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
          }, 100);
          onScrollCompleteRef.current?.();
        }
      });
    }
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      // Session ended / unmounted: drop the runtime show_file cache so the
      // next session doesn't inherit this session's toolCallIds.
      resetShowFileResults();
      // toolCallNameRef.current is read here only as a defensive flush; the
      // ref is component-scoped and disappears with the next mount anyway.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      toolCallNameRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSessionUiState({ systemPrompt });
  }, [systemPrompt]);

  useEffect(() => {
    setSessionUiState({ branchTree: liveTree ?? data?.tree ?? [], branchActiveLeafId: activeLeafId });
  }, [data?.tree, activeLeafId, liveTree]);

  // Keep the store's leaf-change handler ref pointing at the latest callback.
  // We don't include this in a useEffect (it would lag one render behind); a
  // direct call here means AppShell's BranchNavigator always calls the freshest
  // handler when the user clicks a branch.
  setLeafChangeHandler(handleLeafChange);

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
  useEffect(() => { setSessionUiState({ sessionStats }); }, [sessionStats]);
  useEffect(() => { setSessionUiState({ contextUsage }); }, [contextUsage]);
  useEffect(() => { setSessionUiState({ isStreaming: streamState.isStreaming }); }, [streamState.isStreaming]);
  // Publish the wider "agent is busy with this turn" flag so the
  // conversation-tree panel can lock card clicks for the entire turn,
  // not just the streaming sub-window. (See SessionUiState.agentRunning.)
  useEffect(() => { setSessionUiState({ agentRunning }); }, [agentRunning]);

  // Clear any pending bot-revert timer when this session unmounts so
  // a stale timer doesn't fire `setGrokbotConfig` against an unmounted
  // hook (which would still mutate the module-level store and silently
  // snap the sidebar bot to "searching" after the user already moved on).
  useEffect(() => () => {
    if (botRevertTimerRef.current !== null) {
      clearTimeout(botRevertTimerRef.current);
      botRevertTimerRef.current = null;
    }
  }, []);

  return {
    // State
    data, loading, error, activeLeafId, messages, entryIds, entryTimestamps, inFlightToolResults, streamState,
    agentRunning, modelNames, modelIcons, modelList, modelThinkingLevels, modelThinkingLevelMaps, newSessionModel,
    toolSelection, availableTools, toolsLoading, toolsError,
    thinkingLevel,
    retryInfo, contextUsage, systemPrompt,
    currentModel, displayModel, sessionStats,
    agentPhase,
    isNew,
    currentSessionId,
    userMessageHistory,
    // Refs
    sessionIdRef, eventSourceRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef, initialScrollDoneRef, userJustSentRef,
    // Actions
    handleSend, handleAbort, handleNavigate, handleModelChange,
    handleToolSelectionChange, ensureAvailableTools, handleThinkingLevelChange, setActiveLeafId, setData, setMessages,
    dispatch, setAgentRunning,
    // Subscriptions
    handleAgentEventRef,
  };
}

/**
 * True if an assistant message is "body text" for the Pi Bot trigger:
 * contains at least one non-empty text block and no toolUse blocks.
 * Defensive about content shape — agent messages come from SDK events
 * and could in principle be malformed.
 */
function isBodyMessage(msg: AgentMessage): boolean {
  if (msg.role !== "assistant") return false;
  // Partial answer followed by a failure is not a happy ending — keep
  // the bot from flipping to "happy" when the model errored out.
  if ((msg as { stopReason?: unknown }).stopReason === "error") return false;
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) return false;
  let hasText = false;
  let hasToolUse = false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown; text?: unknown };
    if (
      b.type === "text" &&
      typeof b.text === "string" &&
      b.text.trim().length > 0
    ) {
      hasText = true;
    }
    if (b.type === "toolUse") hasToolUse = true;
  }
  return hasText && !hasToolUse;
}
