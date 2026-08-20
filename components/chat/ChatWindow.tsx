"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMessage,
  AssistantMessage,
  SessionInfo,
  ToolCallContent,
  ToolResultMessage,
  ReadFileInfo,
  CompactionPoint,
} from "@/lib/shared/types";
import { countToolCallsByName } from "@/lib/shared/message-display";
import { getFileName } from "@/lib/shared/file-paths";
import { MessageView, CollapseNonceProvider } from "./MessageView";
import { SessionLibraryModal } from "../sessions/session-library/SessionLibraryModal";
import { SessionLibraryOpenButton } from "../sessions/SessionLibraryOpenButton";
import { useSessionLibraryEntries } from "@/hooks/useSessionLibraryEntries";
import { resetSessionLibrary } from "@/hooks/sessionLibraryStore";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { Tooltip } from "../ui/Tooltip";
import { usePendingAskUserQuestions } from "@/hooks/askUserQuestionsStore";
import { AgentTodoPanel } from "../todos/AgentTodoPanel";
import { AskUserQuestionsPanel } from "./AskUserQuestionsPanel";
import { ReplayBar } from "./ReplayBar";
import LoadingState from "../ui/LoadingState";
import { useAgentSession } from "@/hooks/useAgentSession";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import { CompactionDivider } from "./CompactionDivider";
import { setChatHeaderActions } from "@/hooks/chatHeaderActionsStore";
import type { SlashResource } from "@/lib/shared/slash-commands";
import { ToolCallStatsProvider, useToolCallStatsEmit } from "@/hooks/ToolCallStatsContext";
import { useToolCallStats } from "@/hooks/useToolCallStats";
import { setToolCallStatsScrollCallback, setToolCallStatsState } from "@/hooks/toolCallStatsStore";
import { setAgentControls } from "@/hooks/sessionUiStore";
import { SessionSearch } from "../sessions/SessionSearch";
import { phaseLabel, phaseLoaderVariant, hasStreamingThinking, resolveReadPath, isGroupAnchor, findFinalAssistantIndex, hasDisplayableProcessMessage } from "./chat-window/utils";
import { ProcessDetailsGroup } from "./chat-window/ProcessDetailsGroup";
import { NewSessionPresets } from "./chat-window/NewSessionPresets";

interface Props {
  /** Stable owner token for active-session imperative bridges. */
  tabId?: string;
  /** True only for the controller currently projected into the visible chat view. */
  isActive?: boolean;
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onFirstAssistantReady?: () => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  /** If set, navigate to this entry after the session finishes loading */
  scrollToEntryId?: string | null;
  /** Called after the scroll-to-entry navigation completes */
  onScrollComplete?: () => void;
  onNewSessionRequest?: () => void;
  /** Current cwd of the chat context — shown by ChatInput's CwdPicker (the
   *  active session's cwd, or the new-session pick while no session is selected). */
  cwd?: string | null;
  /** Fired when the CwdPicker picks a different cwd (new-session mode, or
   *  switching projects while a session is idle). */
  onCwdChange?: (cwd: string) => void;
  /** Fired after the auto-name PATCH succeeds — used to refresh the sidebar. */
  onRenameCompleted?: () => void;
  /** Fired as soon as the user confirms a rename — keeps in-memory state in sync. */
  onSessionNameChange?: (name: string) => void;
  /** Open a file path in the right-hand panel (used by Session Library
   *  "Open in tab" buttons). Optional; ChatWindow renders a working
   *  "open file" experience even without it (falls back to a no-op). */
  onOpenFile?: (filePath: string, fileName: string) => void;
  /** Publish this tab's unsent input state for close confirmation. */
  onDraftChange?: (draft: {
    dirty: boolean;
    text: string;
    imageCount: number;
    cursorPosition: number;
  }) => void;
  /** Publish passive per-tab runtime status to the workspace tab bar. */
  onAgentStatusChange?: (status: {
    running: boolean;
    streaming: boolean;
    error: string | null;
  }) => void;
}

function ChatWindowContent({ tabId, isActive = true, session, newSessionCwd, onAgentEnd, onSessionCreated, onFirstAssistantReady, modelsRefreshKey, chatInputRef, scrollToEntryId, onScrollComplete, onNewSessionRequest, cwd, onCwdChange, onRenameCompleted, onSessionNameChange, onOpenFile, onDraftChange, onAgentStatusChange }: Props) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const showToast = useCallback((notification: Parameters<typeof toast.show>[0]) => {
    if (isActiveRef.current) toast.show(notification);
  }, [toast]);
  const [slashResources, setSlashResources] = useState<SlashResource[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  // ── Auto-name scheduling for brand-new sessions ──────────────────────
  // The first assistant message of a new session lands only after pi lazily
  // persists the .jsonl, which is exactly when /api/sessions/[id]/auto-name
  // can read it. We piggyback on the existing onFirstAssistantReady prop,
  // forward it to AppShell (sidebar refresh), and schedule a 1s timer to
  // run auto-name. The actual runner lives below where it can close over
  // currentSessionId / agentRunning / etc.; we keep a ref so the timer
  // always reads the latest closure. currentSessionNameRef mirrors
  // session.name so the post-LLM race check sees the freshest value.
  const autoNamedSessionIdsRef = useRef<Set<string>>(new Set());
  const autoNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runAutoNameRef = useRef<((opts: { mode: "manual" | "auto" }) => Promise<void>) | null>(null);
  const currentSessionNameRef = useRef<string | null>(session?.name ?? null);

  const wrappedOnFirstAssistantReady = useCallback(() => {
    // Forward to AppShell (sidebar refresh — unchanged behavior).
    onFirstAssistantReady?.();
    const sid = session?.id;
    if (!sid) return;
    if (autoNamedSessionIdsRef.current.has(sid)) return;
    autoNamedSessionIdsRef.current.add(sid);
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    autoNameTimerRef.current = setTimeout(() => {
      autoNameTimerRef.current = null;
      runAutoNameRef.current?.({ mode: "auto" });
    }, 1000);
  }, [onFirstAssistantReady, session?.id]);

  // Drop a still-pending timer on unmount (session switch / window teardown)
  // so we never PATCH against a stale session id.
  useEffect(
    () => () => {
      if (autoNameTimerRef.current) {
        clearTimeout(autoNameTimerRef.current);
        autoNameTimerRef.current = null;
      }
    },
    [],
  );

  // Tool call stats: wire the context emit into useAgentSession
  const statsEmit = useToolCallStatsEmit();

  const {
    loading, error, runtimeError, messages, entryIds, entryTimestamps, compactionPoints, streamState,
    agentRunning, modelNames, modelIcons, modelList, modelThinkingLevels, modelThinkingLevelMaps,
    toolSelection, availableTools, toolsLoading, toolsError, thinkingLevel,
    retryInfo,
    displayModel: displayModelValue,
    agentPhase,
    agentTodoRefreshKey,
    isNew,
    messagesEndRef, scrollContainerRef,
    lastUserMsgRef, userJustSentRef,
    handleSend, handleAbort, handleNavigate, handleModelChange,
    handleToolSelectionChange, ensureAvailableTools, handleThinkingLevelChange,
    handleCompact,
    userMessageHistory,
    activeLeafId, currentSessionId,
    inFlightToolResults,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd, onSessionCreated, onFirstAssistantReady: wrappedOnFirstAssistantReady,
    modelsRefreshKey,
    statsEmit,
    scrollToEntryId,
    onScrollComplete,
    isActive,
    controllerId: tabId,
  });

  // Tool call stats hook — snapshot is published to the module store so the
  // right-panel tab + vertical button (in AppShell) can render it.
  const { snapshot } = useToolCallStats(messages);

  useEffect(() => {
    onAgentStatusChange?.({
      running: agentRunning,
      streaming: streamState.isStreaming,
      error: error ?? runtimeError,
    });
  }, [agentRunning, streamState.isStreaming, error, runtimeError, onAgentStatusChange]);

  // First user message text — used to gate the auto-name button. The server
  // route reads the same field from the .jsonl, so this is purely a UI
  // enable/disable hint and never authoritative.
  const firstUserMessageText = useMemo(() => {
    const first = messages.find((m) => m.role === "user");
    if (!first) return null;
    const content = (first as { content: unknown }).content;
    if (typeof content === "string") {
      const trimmed = content.trim();
      return trimmed || null;
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string"
        ) {
          const text = (block as { text: string }).text.trim();
          if (text) return text;
        }
      }
    }
    return null;
  }, [messages]);

  // ── Register agent controls with the palette store ──
  // The ⌘K command palette in AppShell reads these via useAgentControls().
  // Model / thinking / tools are intentionally NOT exposed here — those are
  // picked via the visual controls in ChatInput (which call the same
  // handlers below). Each entry is a stable callback owned by
  // useAgentSession — including them in the dep list would churn the ref
  // every render, so we register once on mount and update isStreaming
  // imperatively.
  useEffect(() => {
    if (!isActive) return;
    setAgentControls({
      abortStreaming: handleAbort,
      isStreaming: agentRunning,
    }, tabId);
    return () => setAgentControls(null, tabId);
    // Handlers come from useAgentSession (stable useCallback refs); only
    // re-register when the bits that drive `when()` predicates change.
  }, [isActive, agentRunning, tabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session Library: derive entries + reset on session change ──
  const { entries: sessionLibraryEntries } = useSessionLibraryEntries(messages);

  // ── AskUserQuestions: when the panel is pending for the active session
  //    we hide the bottom-right button stack — otherwise the row of
  //    launchers (AgentTodoPanel, Session Library, Collapse all, Scroll
  //    to bottom) sits *behind* the question panel and looks like dead
  //    UI, since the panel takes over the chat area's focused interaction
  //    surface. Same `usePendingAskUserQuestions` store hook as the panel
  //    itself, so visibility is automatically in sync without an extra
  //    layer of state. ──
  const pendingAskUserQuestions = usePendingAskUserQuestions(currentSessionId);
  useEffect(() => {
    if (isActive) resetSessionLibrary();
  }, [isActive, currentSessionId]);
  const handleOpenFileFromLibrary = useCallback(
    (filePath: string, fileName: string) => {
      if (onOpenFile) onOpenFile(filePath, fileName);
    },
    [onOpenFile],
  );

  // Export the current session as a single-file HTML download. Mirrors the
  // fetch → blob → object-URL → <a download> pattern in hooks/useTodos.tsx
  // (which exports a todo as a zip).
  const handleExport = useCallback(async () => {
    if (!currentSessionId || isExporting) return;
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (activeLeafId) params.set("leafId", activeLeafId);
      if (locale) params.set("locale", locale);
      const qs = params.toString();
      const url = `/api/sessions/${encodeURIComponent(currentSessionId)}/export${qs ? `?${qs}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({ error: "" }))) as { error?: string };
        throw new Error(error || `status ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      let filename = `session-${currentSessionId.slice(0, 8)}.html`;
      const mStar = /filename\*=UTF-8''([^;]+)/i.exec(cd);
      if (mStar) {
        try { filename = decodeURIComponent(mStar[1]); } catch { /* keep fallback */ }
      } else {
        const mPlain = /filename="?([^";]+)"?/i.exec(cd);
        if (mPlain) filename = mPlain[1];
      }
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      showToast({ kind: "success", message: t("Exported") });
    } catch (error) {
      showToast({
        kind: "error",
        message: `${t("Export failed")}: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setIsExporting(false);
    }
  }, [currentSessionId, activeLeafId, locale, isExporting, showToast, t]);

  // Scroll-to-bottom helper, hoisted before handleCompactClick so the compact
  // path can call it. Sets userScrolledUpRef=false to re-engage sticky-bottom
  // tracking and guards the next 500ms of scroll events as programmatic.
  const handleToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    userScrolledUpRef.current = false;
    setShowToBottom(false);
    isProgrammaticScrollRef.current = true;
    // scrollHeight, not messagesEndRef.scrollIntoView: the latter aligns to
    // the scrollport edges and leaves the container's bottom padding visible
    // as a gap. Setting scrollTop directly to scrollHeight scrolls to the
    // absolute bottom regardless of padding/layout.
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setTimeout(() => { isProgrammaticScrollRef.current = false; }, 500);
  }, [scrollContainerRef]);

  // ── Manual compaction lifecycle lives in useAgentSession (see
  // handleCompact). The hook owns the SSE connection, busy state,
  // explicit post-success reload, and busy cleanup on failure — so a
  // compact against an idle session whose EventSource was never open
  // still renders the compaction divider + tree card without a manual
  // reload. Reachable from both the chat footer `Compact` button and the
  // `/compact` slash command (both go through handleCompactClick).
  const handleCompactClick = useCallback(async () => {
    if (!currentSessionId) return;
    if (agentRunning) {
      showToast({ kind: "error", message: t("Wait for the current turn to end before compacting.") });
      return;
    }
    // Scroll to the bottom right away so the user sees the "Compacting..."
    // status row even if they were scrolled up reviewing older messages.
    handleToBottom();
    await handleCompact();
    // handleCompact awaits loadSession, which re-renders with the trailing
    // compaction divider appended below the last message. The first smooth
    // scroll landed at the pre-reload scrollHeight, so re-scroll to the new
    // bottom to bring the divider into view.
    handleToBottom();
  }, [currentSessionId, agentRunning, handleCompact, handleToBottom, showToast, t]);

  // Running summary for the vertical toolbar badge
  const runningSummary = agentPhase?.kind === "running_tools" && agentPhase.tools.length > 0
    ? t("{n} running · {m} total").replace("{n}", String(agentPhase.tools.length)).replace("{m}", String(snapshot.totalCount))
    : snapshot.totalCount > 0
      ? t("{n} total").replace("{n}", String(snapshot.totalCount))
      : undefined;

  // Publish the latest stats snapshot + summary to the module store so
  // AppShell's right-panel tab + vertical button can render them without
  // owning the reducer state themselves.
  useEffect(() => {
    if (!isActive) return;
    setToolCallStatsState({ snapshot, runningSummary });
  }, [isActive, snapshot, runningSummary]);

  // ── Scroll-to-bottom: auto-track during streaming, pause on user scroll-up ──
  const [showToBottom, setShowToBottom] = useState(false);
  const userScrolledUpRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);

  // Detect user-initiated scroll intent via wheel/touch events. We can't rely
  // on the scroll event alone: during fast streaming each chunk re-arms
  // isProgrammaticScrollRef for ~150ms, so the guard in handleScroll eats the
  // user's own scroll event and userScrolledUpRef never flips. wheel/touchmove
  // are not produced by scrollIntoView, so they capture intent before the
  // scroll happens and reliably disengage sticky-bottom mode.
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    // Only treat upward scroll (deltaY < 0) as "user wants to disengage".
    // Scrolling down at the bottom is a no-op; don't surface the button or
    // flip sticky-bottom off in that case.
    if (e.deltaY < 0) {
      userScrolledUpRef.current = true;
      setShowToBottom(true);
    }
  }, []);

  const handleTouchMove = useCallback(() => {
    // Touch has no direction; assume the user is actively scrolling.
    userScrolledUpRef.current = true;
    setShowToBottom(true);
  }, []);

  // ── In-session search state ──
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchKeywords, setSearchKeywords] = useState<string[]>([]);
  const [matchedEntryIds, setMatchedEntryIds] = useState<Set<string>>(new Set());
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null);
  const [pendingJumpEntryId, setPendingJumpEntryId] = useState<string | null>(null);

  // ── Replay ("time travel"): message-level scrubber. All state is local so it
  // resets on session switch (ChatWindow remounts via key={sessionKey}). ──
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const handleReplayIndexChange = useCallback((n: number) => setReplayIndex(n), []);
  const handleReplayPlayingChange = useCallback((p: boolean) => setReplayPlaying(p), []);
  const handleReplaySpeedChange = useCallback((s: number) => setReplaySpeed(s), []);
  const closeReplay = useCallback(() => {
    setReplayOpen(false);
    setReplayPlaying(false);
  }, []);

  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = dist < 100;
    userScrolledUpRef.current = !nearBottom;
    setShowToBottom(!nearBottom);
  }, [scrollContainerRef]);

  // ── 一键折叠 ──
  // Bumped on every click. Subscribed by ThinkingBlock / ToolCallBlock /
  // ProcessDetailsGroup via CollapseNonceProvider; each block uses it as a
  // one-shot signal to fold itself without disturbing per-block manual state.
  const [collapseNonce, setCollapseNonce] = useState(0);
  const handleCollapseAll = useCallback(() => {
    setCollapseNonce((n) => n + 1);
  }, []);

  // ── In-session search: Ctrl+F toggle ──
  useEffect(() => {
    if (!isActive) return;
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f" && session) {
        e.preventDefault();
        setSearchVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isActive, session]);

  // ── In-session search: close on session change ──
  useEffect(() => {
    setSearchVisible(false);
    setSearchKeywords([]);
    setMatchedEntryIds(new Set());
    setHighlightEntryId(null);
    setPendingJumpEntryId(null);
    setReplayOpen(false);
    setReplayPlaying(false);
  }, [session?.id]);

  // ── Replay: force-close when the agent starts running (replay and a live
  // stream must not coexist — the truncated view would fight the SSE tail). ──
  useEffect(() => {
    if (streamState.isStreaming || agentRunning) {
      setReplayOpen(false);
      setReplayPlaying(false);
    }
  }, [streamState.isStreaming, agentRunning]);

  // ── In-session search: results change callback ──
  const handleSearchResultsChange = useCallback((ids: string[], keyword: string) => {
    setMatchedEntryIds(new Set(ids));
    setSearchKeywords(keyword ? [keyword] : []);
    if (!keyword) setHighlightEntryId(null);
  }, []);

  // ── In-session search: jump to a message ──
  const handleSearchJumpTo = useCallback((entryId: string, leafId: string) => {
    // Navigate to the branch containing this message
    handleNavigate(leafId);
    setPendingJumpEntryId(entryId);
  }, [handleNavigate]);

  // ── In-session search: close callback ──
  const handleSearchClose = useCallback(() => {
    setSearchVisible(false);
    setSearchKeywords([]);
    setMatchedEntryIds(new Set());
    setHighlightEntryId(null);
  }, []);

  // ── In-session search: scroll to entry after branch switch ──
  useEffect(() => {
    if (!pendingJumpEntryId) return;
    const idx = entryIds.indexOf(pendingJumpEntryId);
    if (idx === -1) return;

    // Compute visible message index
    let visibleIdx = 0;
    for (let i = 0; i < idx; i++) {
      const m = messages[i];
      if (m && (m.role === "user" || m.role === "assistant")) visibleIdx++;
    }

    const el = messageRefs.current[visibleIdx];
    const container = scrollContainerRef.current;
    if (el && container) {
      userScrolledUpRef.current = false;
      setShowToBottom(false);
      const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top: elTop - 20, behavior: "smooth" });
    }

    setHighlightEntryId(pendingJumpEntryId);
    setPendingJumpEntryId(null);

    // Flash highlight off after 2s
    const timer = setTimeout(() => setHighlightEntryId(null), 2000);
    return () => clearTimeout(timer);
  }, [pendingJumpEntryId, entryIds, messages, scrollContainerRef]);

  // ── Auto-scroll to bottom during streaming ──
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    // Streaming just started. isStreaming flickers false→true at *every*
    // assistant-message boundary (between turns, including the one right
    // after a tool call), so an unconditional reset would yank a user
    // who's reading the previous response back to the bottom whenever a
    // new message begins. Only re-engage sticky-bottom when the user
    // actually asked for a response (userJustSentRef) or was already at
    // the bottom (e.g. session resume / auto-retry with no handleSend).
    if (streamState.isStreaming && !prevStreamingRef.current) {
      const el = scrollContainerRef.current;
      const dist = el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0;
      if (userJustSentRef.current || dist < 100) {
        userScrolledUpRef.current = false;
        setShowToBottom(false);
      }
      userJustSentRef.current = false;
    }
    prevStreamingRef.current = streamState.isStreaming;

    // Auto-scroll on every streaming update (unless user paused)
    if (streamState.isStreaming && !userScrolledUpRef.current) {
      const el = scrollContainerRef.current;
      if (el) {
        isProgrammaticScrollRef.current = true;
        // Clear the button synchronously so the user doesn't see it for the
        // 150ms while the programmatic-scroll guard is up — handleScroll is
        // gated by that flag and won't recompute showToBottom until later.
        setShowToBottom(false);
        // scrollTop = scrollHeight scrolls to the absolute bottom of the
        // scrollable area (browser clamps to scrollHeight - clientHeight).
        // messagesEndRef.scrollIntoView aligns to the scrollport and leaves a
        // gap equal to the container's bottom padding.
        el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
        setTimeout(() => { isProgrammaticScrollRef.current = false; }, 150);
      }
    }
  }, [streamState.streamingMessage, streamState.isStreaming, scrollContainerRef, userJustSentRef]);

  // ── Auto-scroll to the truncation point as replay advances ──
  useEffect(() => {
    if (!replayOpen) return;
    if (userScrolledUpRef.current) return;
    isProgrammaticScrollRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    const timer = setTimeout(() => { isProgrammaticScrollRef.current = false; }, 200);
    return () => clearTimeout(timer);
  }, [replayIndex, replayOpen, messagesEndRef]);

  const onDrop = useCallback((files: File[]) => {
    chatInputRef?.current?.addImages(files);
  }, [chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
  messageRefs.current = Array(visibleMessages.length)
    .fill(null)
    .map((_, i) => messageRefs.current[i] ?? null);

  // Replay is only active for a settled (non-streaming) session. When active,
  // the chat renders only messages[0..replayIndex]; toolResultsMap is still
  // built from the FULL messages so a tool call still pairs with its result
  // even when the result sits past the cutoff.
  const replayActive = replayOpen && !streamState.isStreaming && !agentRunning;
  const renderMessages = replayActive ? messages.slice(0, replayIndex) : messages;
  const renderEntryIds = replayActive ? entryIds.slice(0, replayIndex) : entryIds;
  const renderEntryTimestamps = replayActive ? entryTimestamps.slice(0, replayIndex) : entryTimestamps;

  // Map each compaction point's first displayed message entry id → the point,
  // so the chat list can insert a divider right before that message. Points
  // with no `beforeMessageEntryId` are tail-markers (compaction landed at
  // the end of the visible path with no new messages after it) and get
  // rendered as a trailing divider below the message list.
  const { dividerBefore, trailingCompactionPoints } = useMemo(() => {
    const m = new Map<string, CompactionPoint>();
    const tail: CompactionPoint[] = [];
    for (const p of compactionPoints) {
      if (p.beforeMessageEntryId) m.set(p.beforeMessageEntryId, p);
      else tail.push(p);
    }
    return { dividerBefore: m, trailingCompactionPoints: tail };
  }, [compactionPoints]);

  // A freshly sent user message, or a message continuing an auto-compacted
  // turn, is added to `messages` before pi persists its entry, so `entryIds`
  // temporarily ends earlier. If a compaction point is still a tail marker
  // during that window, it belongs immediately before the first such message
  // rather than below the whole turn. Once the next context load supplies the
  // real entry id, `dividerBefore` takes over automatically.
  const optimisticCompactionMessageIdx = useMemo(() => {
    if (trailingCompactionPoints.length === 0) return -1;
    const idx = renderEntryIds.length;
    return renderMessages[idx] ? idx : -1;
  }, [renderEntryIds, renderMessages, trailingCompactionPoints]);

  // Per-turn duration map: keyed by the index of the LAST assistant message of
  // each turn. startMs = the user message timestamp; endMs = the entry-level
  // persistence timestamp of that assistant (i.e. when its stream finished),
  // missing while the turn is still streaming or for files without timestamps.
  // running marks the turn whose tail is currently streaming (last assistant
  // message), so the footer can show a live "Elapsed" tick without touching
  // the isStreaming prop path used elsewhere.
  const turnDurationMap = useMemo(() => {
    const map = new Map<number, { startMs: number; endMs?: number; running: boolean }>();
    for (let i = 0; i < renderMessages.length; i++) {
      const m = renderMessages[i];
      if (m.role !== "user" || typeof m.timestamp !== "number") continue;
      let lastAssistant = -1;
      for (let j = i + 1; j < renderMessages.length && renderMessages[j].role !== "user"; j++) {
        if (renderMessages[j].role === "assistant") lastAssistant = j;
      }
      if (lastAssistant === -1) continue;
      const endMs = renderEntryTimestamps[lastAssistant];
      map.set(lastAssistant, {
        startMs: m.timestamp,
        endMs: endMs ?? undefined,
        running: streamState.isStreaming && lastAssistant === renderMessages.length - 1,
      });
    }
    return map;
  }, [renderMessages, renderEntryTimestamps, streamState.isStreaming]);

  // Whether any currently-rendered message contains something foldable.
  // Derived from the same messages slice the scroll list uses so a streamed
  // turn whose process group hasn't rendered yet still gates correctly.
  const hasCollapsible = useMemo(
    () => renderMessages.some((m) => hasDisplayableProcessMessage(m) || (m.role === "assistant" && (m.content ?? []).some((b) => b.type === "thinking" || b.type === "toolCall"))),
    [renderMessages],
  );
  // Agent running: button stays mounted but is disabled + dimmed so the
  // affordance is stable. A mid-stream collapse would race with new blocks
  // arriving and re-expanding, so we gate the click instead of hiding.
  const collapseAllEnabled = hasCollapsible && !agentRunning;

  // Last user message / last turn anchor — used by
  // the turn renderer and the streaming gallery below.
  let lastUserIdx = -1;
  for (let i = renderMessages.length - 1; i >= 0; i--) {
    if (renderMessages[i].role === "user") { lastUserIdx = i; break; }
  }
  let lastAnchorIdx = -1;
  for (let i = renderMessages.length - 1; i >= 0; i--) {
    if (isGroupAnchor(renderMessages[i])) { lastAnchorIdx = i; break; }
  }
  // lastAnchorIdx was previously used to gate the per-turn gallery rendering.
  // With the Session Library modal owning all show_file rendering, the only
  // remaining live consumer was `isLiveTurn`, which we just removed. Keep the
  // calculation here so a future reintroduction (e.g. a "currently streaming"
  // banner) has the index ready without having to recompute it.
  void lastAnchorIdx;
  const replayLabel = (() => {
    const base = `${replayIndex} / ${messages.length}`;
    const m = messages[replayIndex - 1] as (AgentMessage & { timestamp?: number }) | undefined;
    if (m?.timestamp) return `${base} · ${new Date(m.timestamp).toLocaleTimeString()}`;
    return base;
  })();
  const openReplay = useCallback(() => {
    setReplayIndex(messages.length);
    setReplayPlaying(false);
    setReplayOpen(true);
  }, [messages.length]);

  // Map every visible tool call's toolCallId to its visible message index.
  // Used by handleScrollToToolCall; rebuilt when messages change so newly
  // streamed tool calls become jumpable without delay.
  const toolCallToVisibleIdx = useMemo(() => {
    const map = new Map<string, number>();
    let vi = 0;
    for (const msg of messages) {
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      if (msg.role === "assistant") {
        for (const block of (msg as AssistantMessage).content ?? []) {
          if (block.type === "toolCall") {
            map.set((block as ToolCallContent).toolCallId, vi);
          }
        }
      }
      vi++;
    }
    return map;
  }, [messages]);

  // Scroll a tool call into view by its toolCallId. Shared between the stats
  // drawer (click on a tool name) and the agent-todo panel (click on a
  // completed task that maps back to a toolCallId).
  const handleScrollToToolCall = useCallback((toolCallId: string) => {
    const idx = toolCallToVisibleIdx.get(toolCallId);
    if (idx === undefined) return;
    const el = messageRefs.current[idx];
    const container = scrollContainerRef.current;
    if (el && container) {
      userScrolledUpRef.current = false;
      setShowToBottom(false);
      const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top: elTop - 20, behavior: "smooth" });
    }
  }, [toolCallToVisibleIdx, messageRefs, scrollContainerRef]);

  // Register the scroll callback with the module store so the right-panel tab
  // body can jump to a tool-call message when the user clicks a row. Clear on
  // unmount so a stale callback can't be invoked from a different session.
  useEffect(() => {
    if (!isActive) return;
    setToolCallStatsScrollCallback(handleScrollToToolCall, tabId);
    return () => setToolCallStatsScrollCallback(null, tabId);
  }, [isActive, handleScrollToToolCall, tabId]);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;
  const isStreamingThinking = streamState.isStreaming && hasStreamingThinking(streamState.streamingMessage);

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const sessionId = session?.id;

  // ── Auto-name: LLM-driven session name generation (moved up from ChatInput
  // when the button relocated to the AppShell footer). The 3s "generated
  // name" label flash was dropped with the move — the sidebar updates
  // immediately and a toast already confirms the rename. ──
  const [isAutoNaming, setIsAutoNaming] = useState(false);
  const confirm = useConfirm();
  const currentSessionName = session?.name ?? null;

  // Keep the ref in sync so the post-LLM race check (after the 5–30s wait)
  // sees a freshly-named session even though the in-flight closure has
  // captured the pre-LLM render value.
  useEffect(() => {
    currentSessionNameRef.current = currentSessionName;
  }, [currentSessionName]);

  // Shared core for both the manual button (mode "manual") and the
  // 1s-after-first-assistant auto-trigger (mode "auto"). Manual preserves
  // the user-confirm modal and the agent-running guard; auto skips both
  // (silent, may piggyback on the in-flight first turn) but enforces the
  // race guard: if session.name is already non-empty at trigger time or
  // when the LLM response arrives, bail silently — manual rename wins
  // (Q3 = A).
  const runAutoName = useCallback(async ({ mode }: { mode: "manual" | "auto" }) => {
    if (!sessionId) return;
    if (isAutoNaming) return;
    if (mode === "manual" && agentRunning) return;
    if (!firstUserMessageText || !firstUserMessageText.trim()) return;

    // Auto-mode pre-flight: a sidebar rename that landed in the 1s window
    // before the LLM call already won — no LLM call needed.
    if (mode === "auto" && currentSessionNameRef.current && currentSessionNameRef.current.trim()) {
      return;
    }

    if (mode === "manual" && currentSessionName && currentSessionName.trim()) {
      const ok = await confirm({
        title: t("Auto-name session?"),
        description: t("This will replace the current session name."),
        confirmLabel: t("Auto-name"),
        cancelLabel: t("Cancel"),
        destructive: false,
      });
      if (!ok) return;
    }

    setIsAutoNaming(true);
    try {
      const suggestRes = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/auto-name`,
        { method: "POST" },
      );
      const suggestBody = (await suggestRes.json().catch(() => ({}))) as {
        name?: unknown;
        error?: unknown;
      };
      if (!suggestRes.ok || typeof suggestBody.name !== "string") {
        const reason = typeof suggestBody.error === "string" ? suggestBody.error : `HTTP ${suggestRes.status}`;
        throw new Error(reason);
      }
      const name = suggestBody.name.trim();
      if (!name) {
        showToast({ kind: "error", message: t("Auto-naming returned an empty name") });
        return;
      }

      // Auto-mode post-LLM race check: a sidebar rename during the LLM
      // call now wins — silent skip, no error toast (Q3 = A).
      if (mode === "auto" && currentSessionNameRef.current && currentSessionNameRef.current.trim()) {
        return;
      }

      const patchRes = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
      if (!patchRes.ok) {
        const body = (await patchRes.json().catch(() => ({}))) as { error?: unknown };
        const reason = typeof body.error === "string" ? body.error : `HTTP ${patchRes.status}`;
        throw new Error(reason);
      }

      onSessionNameChange?.(name);
      try { await onRenameCompleted?.(); } catch { /* sidebar refresh is best-effort */ }
      if (mode === "manual") {
        showToast({ kind: "success", message: `${t("Renamed")} ${name}` });
      }
    } catch (error) {
      showToast({
        kind: "error",
        message: `${t("Auto-naming failed")}: ${
          error instanceof Error && error.message ? error.message : t("Network error")
        }`,
      });
    } finally {
      setIsAutoNaming(false);
    }
  }, [
    sessionId,
    isAutoNaming,
    agentRunning,
    firstUserMessageText,
    currentSessionName,
    confirm,
    showToast,
    onSessionNameChange,
    onRenameCompleted,
    t,
  ]);

  // Keep the timer-side ref pointing at the latest closure so it always
  // sees the freshest sessionId / agentRunning / currentSessionName.
  useEffect(() => {
    runAutoNameRef.current = runAutoName;
  }, [runAutoName]);

  // Manual button entry point — today's behavior (confirm + agent-running
  // guard) lives in runAutoName({ mode: "manual" }).
  const handleAutoName = useCallback(() => {
    void runAutoName({ mode: "manual" });
  }, [runAutoName]);

  // Auto-name is only available when there's a session, a usable first user
  // message, the agent isn't running, and no LLM call is already in flight.
  const canAutoName = Boolean(
    sessionId &&
    firstUserMessageText &&
    firstUserMessageText.trim() &&
    !agentRunning &&
    !isAutoNaming
  );

  // ── Publish Replay / Export / Auto-name actions for the AppShell footer.
  // Rebuilt only when a dependency changes; the store's content guard then
  // skips AppShell re-renders when nothing actually changed. ──
  const headerActions = useMemo(() => ({
    onOpenReplay: openReplay,
    replayVisible: !streamState.isStreaming && !agentRunning && messages.length > 0,
    onExport: handleExport,
    exportVisible: Boolean(session) && !agentRunning,
    isExporting,
    onAutoName: handleAutoName,
    autoNameVisible: Boolean(session) && !agentRunning,
    canAutoName,
    isAutoNaming,
    onCompact: handleCompactClick,
    // Same visibility rule as export/auto-name: only when a session is
    // selected and the agent isn't running. Disabled-state of the button
    // is purely UI; we also refuse to dispatch while `agentRunning` is
    // true, so the click handler is a no-op defense-in-depth.
    compactVisible: Boolean(session) && !agentRunning,
    isCompacting: agentPhase?.kind === "compacting",
    compactDisabled: agentRunning,
  }), [
    openReplay,
    streamState.isStreaming,
    agentRunning,
    messages.length,
    handleExport,
    session,
    isExporting,
    handleAutoName,
    canAutoName,
    isAutoNaming,
    handleCompactClick,
    agentPhase,
  ]);

  useEffect(() => {
    if (!isActive) return;
    setChatHeaderActions(headerActions, tabId);
    return () => setChatHeaderActions(null, tabId);
  }, [isActive, headerActions, tabId]);

  const slashResourceKey = sessionId ?? (newSessionCwd ? `new:${newSessionCwd}` : "none");

  useEffect(() => {
    const controller = new AbortController();
    const params = sessionId
      ? `sessionId=${encodeURIComponent(sessionId)}`
      : newSessionCwd ? `cwd=${encodeURIComponent(newSessionCwd)}` : "";

    if (!params) {
      setSlashResources([]);
      return;
    }

    const loadSlashResources = async () => {
      try {
        const response = await fetch(`/api/slash-commands?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { commands?: SlashResource[] };
        if (!controller.signal.aborted) setSlashResources(data.commands ?? []);
      } catch (error) {
        // A request can reject as TypeError: Failed to fetch when its
        // AbortController is triggered during a session/cwd switch. Treat
        // every rejection after abort as stale, not as a real load failure.
        if (controller.signal.aborted || (error as { name?: string }).name === "AbortError") return;
        console.error("Failed to load slash commands:", error);
        setSlashResources([]);
      }
    };

    void loadSlashResources();

    return () => controller.abort();
  }, [sessionId, newSessionCwd]);

  // Fetch the profile username once for the new-session welcome line. Best-
  // effort: a missing / failed fetch falls back to "Guest", same as ProfileBlock.
  const [username, setUsername] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { username?: unknown }) => {
        if (cancelled) return;
        setUsername(typeof d.username === "string" ? d.username : null);
      })
      .catch(() => {
        if (!cancelled) setUsername(null);
      });
    return () => { cancelled = true; };
  }, []);

  const chatInputElement = (
    <>
      <AskUserQuestionsPanel
        sessionId={currentSessionId}
        onAppear={handleToBottom}
      />
      <ChatInput
        ref={chatInputRef}
        onSend={handleSend}
        onAbort={handleAbort}
        isStreaming={agentRunning}
        sessionBusy={agentRunning}
        model={displayModelValue}
        modelNames={modelNames}
        modelIcons={modelIcons}
        modelList={modelList}
        onModelChange={handleModelChange}
        toolSelection={toolSelection}
        availableTools={availableTools}
        toolsLoading={toolsLoading}
        toolsError={toolsError}
        onToolSelectionChange={isNew ? handleToolSelectionChange : undefined}
        onEnsureAvailableTools={ensureAvailableTools}
        thinkingLevel={thinkingLevel}
        onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
        availableThinkingLevels={availableThinkingLevels}
        thinkingLevelMap={currentThinkingLevelMap}
        retryInfo={retryInfo}
        slashResources={slashResources}
        slashResourceKey={slashResourceKey}
        onSlashAction={(action) => {
          if (action === "new") onNewSessionRequest?.();
          else if (action === "compact") handleCompactClick();
        }}
        sessionId={currentSessionId}
        userMessageHistory={userMessageHistory}
        onDraftChange={onDraftChange}
        cwd={cwd ?? null}
        onCwdChange={onCwdChange ?? (() => {})}
      />
    </>
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        {t("Loading session...")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center bg-[rgba(37,99,235,0.06)] backdrop-blur-[1px]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid border-[rgba(37,99,235,0.5)] animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{ transformOrigin: "center", animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-[0_6px_18px_rgba(37,99,235,0.18)]"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="rgba(37,99,235,0.08)" stroke="rgba(37,99,235,0.50)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="rgba(37,99,235,0.16)" stroke="rgba(37,99,235,0.40)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="rgba(37,99,235,0.22)" stroke="rgba(37,99,235,0.55)" strokeWidth="1.6"/>
            <g stroke="rgba(37,99,235,0.45)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      {isEmptyNew ? (
        <>
          <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4">
            <div className="mb-8 flex flex-col items-center" style={{ fontFamily: "var(--font-mono)" }}>
              <span style={{ fontSize: 26, color: "var(--text)", fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.2 }}>P<span style={{ color: "var(--accent)" }}>i</span> W<span style={{ color: "var(--accent)" }}>o</span>rk</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                web <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</span>
                <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
                pi <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}</span>
              </span>
              <span
                aria-hidden
                style={{
                  marginTop: 16,
                  fontFamily: "var(--font-sans)",
                  fontSize: 15,
                  fontWeight: 500,
                  color: "var(--text)",
                  lineHeight: 1.5,
                  textAlign: "center",
                  maxWidth: 540,
                  padding: "0 16px",
                }}
              >
                {t("Hi, {name}, what shall we create together today?").replace("{name}", username ?? t("Guest"))}
              </span>
            </div>

            <NewSessionPresets onPickPrompt={(prompt) => chatInputRef?.current?.insertText(prompt)} />
          </div>
          <div className="relative">{chatInputElement}</div>
        </>
      ) : (
      <>
      {replayActive && (
        <ReplayBar
          total={messages.length}
          index={replayIndex}
          playing={replayPlaying}
          speed={replaySpeed}
          positionLabel={replayLabel}
          onIndexChange={handleReplayIndexChange}
          onPlayingChange={handleReplayPlayingChange}
          onSpeedChange={handleReplaySpeedChange}
          onClose={closeReplay}
        />
      )}
      <CollapseNonceProvider value={collapseNonce}>
      <div className="relative flex flex-1 overflow-hidden">
        <div ref={scrollContainerRef} data-scroll-wide onScroll={handleScroll} onWheel={handleWheel} onTouchMove={handleTouchMove} className="relative flex-1 overflow-x-hidden overflow-y-auto px-4 pt-4 pb-20">
          <div className="mx-auto max-w-[820px]">

            {(() => {
              const toolResultsMap = new Map<string, ToolResultMessage>();
              for (const msg of messages) {
                if (msg.role === "toolResult") {
                  toolResultsMap.set(msg.toolCallId, msg);
                }
              }
              // Overlay in-flight partial tool output on top of the settled
              // messages array. Only used for toolCallIds without a settled
              // toolResult yet, so once message_end lands the messages entry
              // wins automatically and we render the authoritative final
              // output. This is what makes a long-running bash command
              // stream its output to the UI in real time instead of showing
              // nothing until tool_execution_end.
              for (const [id, partial] of inFlightToolResults) {
                if (!toolResultsMap.has(id)) {
                  toolResultsMap.set(id, partial);
                }
              }
              // Last turn anchor — computed in the
              // component body so the streaming gallery below shares it.
              let refIdx = 0;

              // Render one message at idx. Optional messageOverride renders a
              // clone (used for the process/answer split of the final assistant).
              // attachRef:false skips the wrapper div + ref — used when the same
              // idx is rendered twice (process clone vs answer clone) so only one
              // ref slot is consumed, and for orphan tool-result clones that
              // wouldn't be visible anyway.
              const renderOne = (
                idx: number,
                opts: {
                  messageOverride?: AgentMessage;
                  attachRef?: boolean;
                  showTimestamp?: boolean;
                  keySuffix?: string;
                  afterContent?: React.ReactNode;
                  readFiles?: ReadFileInfo[];
                  onOpenFile?: (filePath: string, fileName: string) => void;
                } = {},
              ): React.ReactNode => {
                const msg = opts.messageOverride ?? renderMessages[idx];
                const prevAssistantEntryId =
                  msg.role === "user" && idx > 0 && renderMessages[idx - 1].role === "assistant"
                    ? renderEntryIds[idx - 1]
                    : undefined;
                const isVisible = msg.role === "user" || msg.role === "assistant";
                const currentRefIdx = isVisible && opts.attachRef !== false ? refIdx++ : -1;
                let showTimestamp = opts.showTimestamp ?? false;
                if (opts.showTimestamp === undefined) {
                  showTimestamp = false;
                  if (msg.role === "assistant") {
                    showTimestamp = true;
                    for (let j = idx + 1; j < renderMessages.length; j++) {
                      const r = renderMessages[j].role;
                      if (r === "user") break;
                      if (r === "assistant") { showTimestamp = false; break; }
                    }
                    // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                    if (showTimestamp && streamState.isStreaming && idx === renderMessages.length - 1) {
                      showTimestamp = false;
                    }
                  }
                }
                const key = `${idx}-${opts.keySuffix ?? ""}`;
                const view = (
                  <MessageView
                    key={key}
                    message={msg}
                    toolResults={toolResultsMap}
                    modelNames={modelNames}
                    modelIcons={modelIcons}
                    entryId={renderEntryIds[idx]}
                    onNavigate={agentRunning ? undefined : handleNavigate}
                    prevAssistantEntryId={agentRunning ? undefined : prevAssistantEntryId}
                    onEditContent={(content) => chatInputRef?.current?.insertIfEmpty(content)}
                    showTimestamp={showTimestamp}
                    keywords={searchKeywords}
                    highlightEntryId={highlightEntryId}
                    isSearchMatch={matchedEntryIds.has(renderEntryIds[idx])}
                    afterContent={opts.afterContent}
                    turnDuration={turnDurationMap.get(idx)}
                    readFiles={opts.readFiles}
                    onOpenFile={opts.onOpenFile}
                  />
                );
                if (currentRefIdx === -1) return view;
                return (
                  <div key={key} ref={(el) => {
                    messageRefs.current[currentRefIdx] = el;
                    if (idx === lastUserIdx) { (lastUserMsgRef as { current: HTMLDivElement | null }).current = el; }
                  }}>
                    {view}
                  </div>
                );
              };

              // Group consecutive non-anchor messages into a foldable process
              // group. Each turn runs from an anchor (user message)
              // to the next anchor; intermediate assistant messages + the
              // process portion of the final assistant are collapsed by default.
              const rendered: React.ReactNode[] = [];
              // Divider before the message at `idx` if that message is the
              // first displayed message after a compaction point.
              const maybeDivider = (idx: number): React.ReactNode => {
                const point = dividerBefore.get(renderEntryIds[idx]);
                if (point) return <CompactionDivider key={`comp-${point.entryId}`} point={point} />;
                if (idx === optimisticCompactionMessageIdx) {
                  return trailingCompactionPoints.map((pendingPoint) => (
                    <CompactionDivider key={`comp-tail-${pendingPoint.entryId}`} point={pendingPoint} />
                  ));
                }
                return null;
              };
              for (let idx = 0; idx < renderMessages.length;) {
                const div = maybeDivider(idx);
                if (div) rendered.push(div);
                const msg = renderMessages[idx];
                if (!isGroupAnchor(msg)) {
                  rendered.push(renderOne(idx));
                  idx += 1;
                  continue;
                }

                const userIdx = idx;
                let endIdx = userIdx + 1;
                while (endIdx < renderMessages.length && !isGroupAnchor(renderMessages[endIdx])) {
                  endIdx += 1;
                }

                const finalAssistantIdx = findFinalAssistantIndex(renderMessages, userIdx, endIdx);
                if (finalAssistantIdx === -1) {
                  for (let i = userIdx; i < endIdx; i++) {
                    // The outer loop already checked the anchor at userIdx;
                    // checking it again here would duplicate its divider.
                    const d = i === userIdx ? null : maybeDivider(i);
                    if (d) rendered.push(d);
                    rendered.push(renderOne(i));
                  }
                  idx = endIdx;
                  continue;
                }

                // Turn-level `read` files: collect every read tool call across
                // this turn's assistant messages, dedupe by resolved path, and
                // drop errored results (read of a nonexistent path). Surfaced
                // as footer chips on the final assistant message.
                const turnCwd = session?.cwd ?? cwd ?? null;
                const readFiles: ReadFileInfo[] = (() => {
                  const seen = new Set<string>();
                  const out: ReadFileInfo[] = [];
                  for (let i = userIdx + 1; i < endIdx; i++) {
                    const m = renderMessages[i];
                    if (m.role !== "assistant") continue;
                    for (const block of (m as AssistantMessage).content ?? []) {
                      if (block.type !== "toolCall") continue;
                      const tc = block as ToolCallContent;
                      if (tc.toolName !== "read") continue;
                      const result = toolResultsMap.get(tc.toolCallId);
                      if (result?.isError) continue;
                      const raw = tc.input?.path;
                      if (typeof raw !== "string" || !raw.trim()) continue;
                      const resolved = resolveReadPath(raw.trim(), turnCwd);
                      if (!resolved || seen.has(resolved)) continue;
                      seen.add(resolved);
                      out.push({ path: resolved, name: getFileName(resolved) });
                    }
                  }
                  return out;
                })();

                // Anchor message (user)
                rendered.push(renderOne(userIdx));

                // Intermediate assistant messages in the turn — these are
                // wrapped in the per-turn fold group. The final assistant
                // message is rendered as a whole below (one MessageView per
                // LLM API call, all its blocks intact).
                const processIndices: number[] = [];
                for (let i = userIdx + 1; i < finalAssistantIdx; i++) processIndices.push(i);

                const visibleProcessIndices = processIndices.filter((i) =>
                  hasDisplayableProcessMessage(renderMessages[i]),
                );
                const processCount = visibleProcessIndices.length;

                // While the agent is still running on this turn, render the
                // process inline instead of folding it. Folding only kicks in
                // once the turn is complete (agentRunning flips back to false)
                // so users see the full think → tool-call → intermediate text
                // flow as it streams, then get a single collapsed summary at
                // the end. Without this, each message_end would re-mount the
                // fold group with a new key and snap it shut on every step.
                //
                // Explicitly excludes the compacting phase: agentRunning flips
                // true while compacting too, but compact doesn't add new
                // content to this turn. Unfolding the last turn's process
                // during compact would (a) swap the JSX tree between
                // <ProcessDetailsGroup> and <Fragment>, which unmounts the
                // group and resets its internal `expanded` state on the way
                // back, and (b) grow the scrollHeight mid-compaction so the
                // scroll-to-bottom click lands above the real bottom. Treat
                // compact as if the session were idle for this rendering
                // decision.
                const isCurrentTurnInProgress =
                  agentRunning &&
                  agentPhase?.kind !== "compacting" &&
                  userIdx === lastUserIdx &&
                  lastUserIdx !== -1;

                const processChildren = (
                  <Fragment>
                    {visibleProcessIndices.map((i) => (
                      <Fragment key={`proc-${i}`}>
                        {maybeDivider(i)}
                        {renderOne(i, { keySuffix: "process" })}
                      </Fragment>
                    ))}
                  </Fragment>
                );

                if (processCount > 0) {
                  if (isCurrentTurnInProgress) {
                    rendered.push(<Fragment key={`process-${userIdx}`}>{processChildren}</Fragment>);
                  } else {
                    rendered.push(
                      <ProcessDetailsGroup
                        key={`process-${userIdx}`}
                        messageCount={processCount}
                        toolCallCounts={countToolCallsByName(renderMessages, visibleProcessIndices, [])}
                      >
                        {processChildren}
                      </ProcessDetailsGroup>,
                    );
                  }
                }

                // Final assistant message: one MessageView for the whole
                // .jsonl entry. All its blocks (thinking + tool calls + text)
                // render in order; the leading ThinkingBlock(s) inside still
                // default to collapsed and fold along with "全部折叠", while
                // the trailing text/image is always visible.
                const finalDiv = maybeDivider(finalAssistantIdx);
                if (finalDiv) rendered.push(finalDiv);
                rendered.push(
                  renderOne(finalAssistantIdx, {
                    keySuffix: "answer",
                    readFiles,
                    onOpenFile: handleOpenFileFromLibrary,
                  }),
                );

                idx = endIdx;
              }
              return rendered;
            })()}

            {streamState.isStreaming && streamState.streamingMessage && (
              <MessageView message={streamState.streamingMessage as AgentMessage} isStreaming modelNames={modelNames} modelIcons={modelIcons} />
            )}

            {/* Trailing compaction dividers — points whose `beforeMessageEntryId`
                doesn't exist yet (compaction just landed at the tail). Renders
                after the last message so a freshly compacted session shows
                the marker immediately, before the next user prompt. */}
            {optimisticCompactionMessageIdx === -1 && trailingCompactionPoints.map((point) => (
              <CompactionDivider key={`comp-tail-${point.entryId}`} point={point} />
            ))}

            {isStreamingThinking && (
              <div className="py-2">
                <LoadingState label={t("Thinking...")} variant="spark" />
              </div>
            )}

            {agentRunning && !streamState.streamingMessage && (
              <div className="py-2">
                <LoadingState
                  label={phaseLabel(agentPhase, t)}
                  variant={phaseLoaderVariant(agentPhase)}
                />
              </div>
            )}

            {agentRunning && !streamState.streamingMessage && (
              <div style={{ height: 120 }} />
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Bottom-right action stack — all launchers stay mounted at all
            times so the affordance is stable. Disabled + dimmed when the
            action doesn't apply. Hard-coded bilingual labels for the
            "回到底部" button per product decision (no i18n key).

            `right` is computed against the parent (`flex-1 overflow-hidden`
            inside ChatWindowContent — same width as ChatInput's wrapper):
            (also hidden while an AskUserQuestions panel is pending for
            this session — the panel takes over the focused interaction
            surface and the row would otherwise look like dead UI behind
            it)
              width ≤ 852 → 16px (= original `right-4`); chat input fills
                              the parent and its right edge == 16px in.
              width > 852 → (W − 820)/2, matching ChatInput's
                              `maxWidth: 820 + margin: auto` gutter, so the
                              launcher stack stays flush with the input's
                              right edge instead of floating into the
                              sidebar gutter. */}
        {pendingAskUserQuestions ? null : (
        <div
          className="pointer-events-none absolute bottom-4 z-10 flex items-end gap-2"
          style={{ right: "max(16px, calc((100% - 820px) / 2))" }}
        >
          {/* Agent Todo launcher (first position). Renders nothing
              itself when there's no plan — the panel hides entirely so
              the chat area stays clean. Click opens a popover anchored
              above-left of this button. */}
          <AgentTodoPanel
            sessionId={session?.id ?? currentSessionId}
            refreshKey={agentTodoRefreshKey}
          />
          {/* Session Library launcher (Q10A: second position). Always
              visible — empty state is shown inside the modal. Unread
              badge appears when entries land while the modal is closed. */}
          <SessionLibraryOpenButton
            count={sessionLibraryEntries.length}
            sessionId={currentSessionId}
          />
          <Tooltip content={t("Collapse all")}>
            <button
              type="button"
              onClick={handleCollapseAll}
              disabled={!collapseAllEnabled}
              aria-label={t("Collapse all")}
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border shadow-lg transition-all duration-200 hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100"
              style={{
                background: "var(--bg-panel)",
                borderColor: "var(--border)",
                color: collapseAllEnabled ? "var(--text-muted)" : "var(--text-dim)",
                opacity: collapseAllEnabled ? 1 : 0.45,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 6 12 12 20 6" />
                <polyline points="4 12 12 18 20 12" />
                <polyline points="4 18 12 24 20 18" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip content={t("Scroll to bottom")}>
            <button
              type="button"
              onClick={handleToBottom}
              disabled={!showToBottom}
              aria-label={t("Scroll to bottom")}
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border shadow-lg transition-all duration-200 hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100"
              style={{
                background: "var(--bg-panel)",
                borderColor: "var(--border)",
                color: showToBottom ? "var(--text-muted)" : "var(--text-dim)",
                opacity: showToBottom ? 1 : 0.45,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </Tooltip>
        </div>
        )}

        {/* Replay toggle now lives next to the input box (ChatInput bottom
            buttons) — opens the time-travel scrubber. Hidden while the agent
            is running (replay must not coexist with a live stream). */}

        {/* Tool call stats are rendered as a right-panel tab by AppShell.
            We just publish the snapshot + scroll callback to the module store. */}
      </div>
      </CollapseNonceProvider>

      <div className="relative">
        {session && (
          <SessionSearch
            sessionId={session.id}
            visible={searchVisible}
            onJumpTo={handleSearchJumpTo}
            onResultsChange={handleSearchResultsChange}
            onClose={handleSearchClose}
          />
        )}
        {chatInputElement}
      </div>
      {/* Session Library modal — portal'd into document.body so it sits
          above all chat UI. Reads UI state from sessionLibraryStore and
          entry data from the live messages array. */}
      {isActive && (
        <SessionLibraryModal
          messages={messages}
          cwd={session?.cwd}
          onOpenFile={handleOpenFileFromLibrary}
        />
      )}
      </>
      )}
    </div>
  );
}

export function ChatWindow(props: Props) {
  return (
    <ToolCallStatsProvider>
      <ChatWindowContent {...props} />
    </ToolCallStatsProvider>
  );
}
