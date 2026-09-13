"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMessage,
  AssistantMessage,
  SessionInfo,
  ToolCallContent,
  ReadFileInfo,
  CompactionPoint,
} from "@/lib/shared/types";
import { countToolCallsByName } from "@/lib/shared/message-display";
import { buildChatTimeline, indexToolResults, isVisibleChatMessage } from "@/lib/shared/chat-timeline";
import { getFileName } from "@/lib/shared/file-paths";
import { extractEditDiffStats, extractWriteDiffStats, sumDiffStats, type ToolDiffStats } from "@/lib/shared/tool-diff-stats";
import { MessageView, CollapseNonceProvider } from "./MessageView";
import { ReadFileChips } from "./ReadFileChips";
import { StreamingBubble } from "./StreamingBubble";
import { StreamingMessageViewport } from "./StreamingMessageViewport";
import { useIsStreamingBody, useIsStreamingError, useIsStreamingThinking, useIsStreamingToolCall, useStreamingHasContent, useStreamingToolCall } from "@/hooks/useStreamingMessage";
import { SessionLibraryModal } from "../sessions/session-library/SessionLibraryModal";
import { SessionLibraryOpenButton } from "../sessions/SessionLibraryOpenButton";
import { useSessionLibraryEntries } from "@/hooks/useSessionLibraryEntries";
import { resetSessionLibrary } from "@/hooks/sessionLibraryStore";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ModelPickerModal } from "./ModelPickerModal";
import { Tooltip } from "../ui/Tooltip";
import { usePendingAskUserQuestions } from "@/hooks/askUserQuestionsStore";
import { SubagentSessionsButton } from "./SubagentSessionsButton";
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
import { phaseLabel, phaseLoaderVariant, resolveReadPath, isGroupAnchor, findFinalAssistantIndex, hasDisplayableProcessMessage } from "./chat-window/utils";
import { ProcessDetailsGroup } from "./chat-window/ProcessDetailsGroup";
import { NewSessionPresets } from "./chat-window/NewSessionPresets";
import { NewSessionNotifyPicker } from "./chat-window/NewSessionNotifyPicker";
import { useAutoNaming } from "./chat-window/hooks/useAutoNaming";
import { useSessionNotifyBinding } from "./chat-window/hooks/useSessionNotifyBinding";
import { useSessionSearch } from "./chat-window/hooks/useSessionSearch";
import { useReplay } from "./chat-window/hooks/useReplay";
import { useScrollFollow } from "./chat-window/hooks/useScrollFollow";
import { useTextSelection } from "@/hooks/useTextSelection";
import { TextSelectionToolbar } from "./text-selection-toolbar";

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
  /** Slash action `/btw`: open the right BTW panel and focus its input.
   *  Wired by AppShell so the main-chat slash menu can jump straight into
   *  a BTW question. */
  onOpenBtw?: () => void;
  /** Open a persisted child session in the workspace tab bar. */
  onOpenSession: (sessionId: string) => void;
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
  /** Fired when the full session payload finishes loading. */
  onSessionInfoLoaded?: (session: SessionInfo) => void;
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

function ChatWindowContent({ tabId, isActive = true, session, newSessionCwd, onAgentEnd, onSessionCreated, onFirstAssistantReady, modelsRefreshKey, chatInputRef, scrollToEntryId, onScrollComplete, onNewSessionRequest, onOpenBtw, onOpenSession, cwd, onCwdChange, onRenameCompleted, onSessionNameChange, onSessionInfoLoaded, onOpenFile, onDraftChange, onAgentStatusChange }: Props) {
  const streamingKey = tabId ?? session?.id ?? "default";
  const { t, locale } = useI18n();
  const toast = useToast();
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const showToast = useCallback((notification: Parameters<typeof toast.show>[0]) => {
    if (isActiveRef.current) toast.show(notification);
  }, [toast]);
  const [slashResources, setSlashResources] = useState<SlashResource[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const sessionInfoReportedRef = useRef<string | null>(null);

  // ── Auto-naming ──────────────────────────────────────────────────────
  // The runner lives in `chat-window/hooks/useAutoNaming.ts`, but it needs the
  // first user message text — which only exists after useAgentSession — while
  // useAgentSession needs the first-assistant callback. This stable delegate
  // breaks the cycle; the hook fills the ref on every render, the same shape
  // the pre-hook code used for its timer.
  const autoNameReadyRef = useRef<() => void>(() => {});
  const handleFirstAssistantReady = useCallback(() => {
    autoNameReadyRef.current();
  }, []);

  // Same delegation for the scroll landing of an entry navigation: it is a
  // scroll write, so `useScrollFollow` owns it — but that hook needs the refs
  // useAgentSession returns and is therefore created later. The scroll hook
  // fills the ref from an effect (see the assignment below); the navigation
  // reports back a microtask later, so the ref is always filled by then.
  const entryNavigatedRef = useRef<() => void>(() => {});
  const handleEntryNavigated = useCallback(() => {
    entryNavigatedRef.current();
  }, []);

  // Tool call stats: wire the context emit into useAgentSession
  const statsEmit = useToolCallStatsEmit();

  const {
    data, loading, error, runtimeError, messages, entryIds, entryTimestamps, compactionPoints, streamState,
    agentRunning, modelNames, modelIcons, modelList, modelThinkingLevels, modelThinkingLevelMaps,
    toolSelection, availableTools, toolsLoading, toolsError, thinkingLevel,
    retryInfo,
    displayModel: displayModelValue,
    agentPhase,
    subagentRefreshKey,
    isNew,
    messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef,
    handleSend, handleAbort, handleNavigate, handleModelChange,
    handleToolSelectionChange, ensureAvailableTools, handleThinkingLevelChange,
    handleCompact,
    userMessageHistory,
    activeLeafId, currentSessionId,
    inFlightToolResults,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd, onSessionCreated, onFirstAssistantReady: handleFirstAssistantReady,
    modelsRefreshKey,
    statsEmit,
    scrollToEntryId,
    onEntryNavigated: handleEntryNavigated,
    isActive,
    controllerId: tabId,
  });

  // ── Session notification binding ──────────────────────────────────────
  // Both bindings (the new-session pick, and the current session's saved
  // channel) are owned by the local hook; its rules live in
  // `lib/shared/session-notify-binding.ts`.
  const { pickedChannelId, setPickedChannelId, boundChannelId, setNotifyChannel } = useSessionNotifyBinding({
    sessionId: session?.id ?? null,
    currentSessionId,
    isActive,
    showToast,
    t,
  });

  useEffect(() => {
    if (!data?.info || session?.id !== data.sessionId || sessionInfoReportedRef.current === data.sessionId) return;
    sessionInfoReportedRef.current = data.sessionId;
    onSessionInfoLoaded?.(data.info);
  }, [data, onSessionInfoLoaded, session?.id]);

  // Tool call stats hook — snapshot is published to the module store so the
  // right-panel tab + vertical button (in AppShell) can render it.
  const { snapshot } = useToolCallStats(messages);

  // ── Text-selection toolbar ──
  // Scoped to the message scroll container so selections in the chat
  // input, sidebars, or the right panel never trigger the toolbar.
  // Quote inserts a markdown blockquote at the current input caret
  // (reusing the existing insertText imperative handle). Translate
  // publishes the snippet to the translate panel's external-input
  // store and asks AppShell to open the translate tab via a
  // fire-and-forget event.
  const selection = useTextSelection(scrollContainerRef);
  // Subscribe to the streaming store directly so per-token updates do
  // not re-render ChatWindowContent's tree (ChatInput, historical
  // MessageViews, panels, ...). The streaming bubble is rendered by
  // StreamingBubble, which subscribes on its own.
  const streamingStoreIsThinking = useIsStreamingThinking(streamingKey);
  const streamingStoreIsBody = useIsStreamingBody(streamingKey);
  const streamingStoreIsToolCall = useIsStreamingToolCall(streamingKey);
  // The live toolCall block (name + args) so the loading label can show what
  // is actually running instead of a generic "running tool" placeholder.
  const streamingToolCall = useStreamingToolCall(streamingKey);
  const streamingStoreIsError = useIsStreamingError(streamingKey);
  // True once streamed content (thinking/body) is on screen, false during
  // the wait-for-first-token gap and between messages. The phase-loading
  // indicator below keys off this instead of `streamState.isStreaming` —
  // the reducer flag flips true at send time (handleSend dispatches
  // "start"), so `agentRunning && !streamState.isStreaming` would never
  // render while waiting for the model. Only flips on content
  // appear/disappear, so per-token updates don't re-render this tree.
  const streamingStoreHasContent = useStreamingHasContent(streamingKey);
  const handleQuoteSelection = useCallback((text: string) => {
    // Markdown blockquote: `> text` followed by a blank line so the
    // user lands on a fresh row to type their follow-up. The trailing
    // blank line is what the standard chat "quote" affordance produces
    // (Notion / Slack) — without it, the user's first keystroke would
    // append to the same line as the quoted content.
    chatInputRef?.current?.insertText(`> ${text}\n\n`);
  }, [chatInputRef]);

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
  //    launchers (Session Library, Collapse all, Scroll
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

  // ── Scroll follow ─────────────────────────────────────────────────────
  // Every chat scroll rule lives in `lib/shared/scroll-follow.ts` and every
  // scroll write in the hook below; this component only forwards events and
  // renders the affordance. The pause flag is a ref because the nested live
  // viewport writes it directly, so the chat window owns it and hands it to
  // both the hook and `StreamingMessageViewport`.
  const userScrolledUpRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const scrollFollow = useScrollFollow({
    isActive,
    scrollContainerRef,
    messagesEndRef,
    lastUserMsgRef,
    pausedRef: userScrolledUpRef,
    messageCount: messages.length,
    pendingScrollToUserRef,
    initialScrollDoneRef,
    onScrollComplete,
  });
  // Feed the scroll hook's entry-landing handler to the stable delegate that
  // was passed to useAgentSession before the hook could be called (see
  // entryNavigatedRef above). Assigned in an effect, not during render, so a
  // concurrent render never publishes a handler it later discards.
  useEffect(() => {
    entryNavigatedRef.current = scrollFollow.handleEntryNavigated;
  }, [scrollFollow.handleEntryNavigated]);

  // Hoisted before handleCompactClick so the compact path can call it. This is
  // an explicit user action, not streaming follow.
  const handleToBottom = scrollFollow.handleToBottom;
  // An explicit jump (a search hit, a tool-call row) re-engages streaming
  // follow: the user asked to go somewhere, so the view should stick there.
  const reengageScrollFollow = scrollFollow.handleExplicitScroll;

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

  // ── /model slash command → model-picker modal ──
  const [modelModalOpen, setModelModalOpen] = useState(false);

  // ── 一键折叠 ──
  // Bumped on every click. Subscribed by ThinkingBlock / ToolCallBlock /
  // ProcessDetailsGroup via CollapseNonceProvider; each block uses it as a
  // one-shot signal to fold itself without disturbing per-block manual state.
  const [collapseNonce, setCollapseNonce] = useState(0);
  const handleCollapseAll = useCallback(() => {
    setCollapseNonce((n) => n + 1);
  }, []);

  // Streaming output is followed by StreamingMessageViewport. ChatWindow
  // intentionally does not move the page-level scrollport while content grows;
  // this keeps a user's outer scroll position stable after they scroll up.

  const onDrop = useCallback((files: File[]) => {
    chatInputRef?.current?.addImages(files);
  }, [chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  // The chat timeline projection is the single source of "which messages are
  // visible, how session indices map to visible ones, and where a tool call
  // lands". The in-session search hook and the render ref array read it.
  const timeline = useMemo(
    () => buildChatTimeline({ messages, entryIds, entryTimestamps }),
    [messages, entryIds, entryTimestamps],
  );
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
  messageRefs.current = Array(timeline.visibleCount)
    .fill(null)
    .map((_, i) => messageRefs.current[i] ?? null);

  // ── In-session search ──
  // State and the entry → visible index jump rule live in the hook, which
  // resolves entries through the timeline projection above.
  const search = useSessionSearch({
    isActive,
    sessionId: session?.id ?? null,
    timeline,
    scrollContainerRef,
    messageRefs,
    onExplicitScroll: reengageScrollFollow,
    onNavigate: handleNavigate,
  });

  // ── Replay ("time travel") ──
  // State and the settled-session gate live in the hook, whose rules are the
  // pure reducer in `lib/shared/replay.ts`.
  const replay = useReplay({
    sessionId: session?.id ?? null,
    isStreaming: streamState.isStreaming,
    agentRunning,
    messages,
  });

  // When replay is active the chat renders only messages[0..cutoff];
  // toolResultsMap is still built from the FULL messages so a tool call still
  // pairs with its result even when the result sits past the cutoff.
  const renderSlice = timeline.sliceForReplay(replay.cropIndex);
  const renderMessages = renderSlice.messages;
  const renderEntryIds = renderSlice.entryIds;
  const renderEntryTimestamps = renderSlice.entryTimestamps;

  // Tool results are shared by historical messages and the live viewport. The
  // latter needs the in-flight overlay too, so a running tool can keep showing
  // partial output inside the fixed-height area.
  const toolResultsMap = useMemo(() => {
    const map = indexToolResults(messages);
    for (const [id, partial] of inFlightToolResults) {
      if (!map.has(id)) map.set(id, partial);
    }
    return map;
  }, [messages, inFlightToolResults]);

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
  // Keep the current turn in a nested fixed-height scrollport while the agent
  // is active. Compaction is deliberately excluded because it does not add a
  // new message and should retain the ordinary chat layout.
  const liveTurnActive = agentRunning && agentPhase?.kind !== "compacting" && lastUserIdx !== -1;

  // Once the current turn's streaming output has begun, keep the streaming
  // message viewport visible for the whole turn. `streamingStoreHasContent`
  // dips back to false between sub-messages (waiting for the model again), so
  // gate on a latched flag instead — reset when the live turn ends.
  const [streamingStartedThisTurn, setStreamingStartedThisTurn] = useState(false);
  useEffect(() => {
    if (!liveTurnActive) {
      setStreamingStartedThisTurn(false);
    } else if (streamingStoreHasContent) {
      setStreamingStartedThisTurn(true);
    }
  }, [liveTurnActive, streamingStoreHasContent]);

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
  // Scroll a tool call into view by its toolCallId, resolving the landing
  // message through the timeline projection. Shared between the stats drawer
  // (click on a tool name).
  const handleScrollToToolCall = useCallback((toolCallId: string) => {
    const idx = timeline.toolCallVisibleIndices.get(toolCallId);
    if (idx === undefined) return;
    const el = messageRefs.current[idx];
    const container = scrollContainerRef.current;
    if (el && container) {
      reengageScrollFollow();
      const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top: elTop - 20, behavior: "smooth" });
    }
  }, [timeline, messageRefs, scrollContainerRef, reengageScrollFollow]);

  // Register the scroll callback with the module store so the right-panel tab
  // body can jump to a tool-call message when the user clicks a row. Clear on
  // unmount so a stale callback can't be invoked from a different session.
  useEffect(() => {
    if (!isActive) return;
    setToolCallStatsScrollCallback(handleScrollToToolCall, tabId);
    return () => setToolCallStatsScrollCallback(null, tabId);
  }, [isActive, handleScrollToToolCall, tabId]);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;
  // Error assistant messages are already rendered from `messages`; when the
  // streaming snapshot is intentionally retained for a retry, avoid showing
  // the same failed call twice.
  const streamingErrorAlreadyRendered = streamingStoreIsError && messages.some((message) =>
    message.role === "assistant" && message.stopReason === "error",
  );
  const isStreamingThinking = streamState.isStreaming && streamingStoreIsThinking;

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const sessionId = session?.id;
  const confirm = useConfirm();

  // ── Auto-naming: the runner, its 1s silent timer, the requests, the toasts
  // and the shell reporting all live in the local hook. The rules (which mode
  // may run when, plus the two rename-race checks) live in
  // `lib/shared/auto-naming.ts`. ──
  const {
    isAutoNaming,
    canAutoName,
    handleAutoName,
    handleFirstAssistantReady: autoNameFirstAssistantReady,
  } = useAutoNaming({
    session,
    agentRunning,
    firstUserMessageText,
    showToast,
    confirm,
    t,
    onSessionNameChange,
    onRenameCompleted,
    onFirstAssistantReady,
  });
  // Feed the hook's first-assistant handler to the stable delegate that was
  // passed to useAgentSession before the hook could be called (see
  // autoNameReadyRef above). Assigned in an effect, not during render, so a
  // concurrent render never publishes a handler it later discards.
  useEffect(() => {
    autoNameReadyRef.current = autoNameFirstAssistantReady;
  }, [autoNameFirstAssistantReady]);

  // ── Publish Replay / Export / Auto-name actions for the AppShell footer.
  // Rebuilt only when a dependency changes; the store's content guard then
  // skips AppShell re-renders when nothing actually changed. ──
  const headerActions = useMemo(() => ({
    onOpenReplay: replay.open,
    replayVisible: replay.buttonVisible,
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
    // Reply-notification channel binding (MoreMenu entry). The setter is
    // stable; the memo rebuilds only when the id changes.
    onSetNotifyChannel: setNotifyChannel,
    notifyVisible: Boolean(session),
    currentNotifyChannelId: boundChannelId,
  }), [
    replay.open,
    replay.buttonVisible,
    agentRunning,
    handleExport,
    session,
    isExporting,
    handleAutoName,
    canAutoName,
    isAutoNaming,
    handleCompactClick,
    agentPhase,
    setNotifyChannel,
    boundChannelId,
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
        // Available for both flows: existing sessions push the change to the
        // live agent via `set_tools` (persisted per session), while new
        // sessions only update local state until the first prompt is sent.
        onToolSelectionChange={handleToolSelectionChange}
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
          else if (action === "btw") onOpenBtw?.();
          else if (action === "model") setModelModalOpen(true);
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
      <TextSelectionToolbar
        state={selection}
        onQuote={handleQuoteSelection}
        onHide={selection.hide}
      />
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
              <span style={{ fontSize: 26, color: "var(--text)", fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.2 }}>Pi Work</span>
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

            <div style={{ marginTop: 26, display: "flex", justifyContent: "center" }}>
              <NewSessionNotifyPicker
                value={pickedChannelId}
                onChange={setPickedChannelId}
              />
            </div>
          </div>
          <div className="relative">{chatInputElement}</div>
        </>
      ) : (
      <>
      {replay.visible && (
        <ReplayBar
          total={messages.length}
          index={replay.index}
          playing={replay.playing}
          speed={replay.speed}
          positionLabel={replay.positionLabel}
          onIndexChange={replay.onIndexChange}
          onPlayingChange={replay.onPlayingChange}
          onSpeedChange={replay.onSpeedChange}
          onClose={replay.onClose}
        />
      )}
      <CollapseNonceProvider value={collapseNonce}>
      <div className="relative flex flex-1 overflow-hidden">
        <div ref={scrollContainerRef} data-scroll-wide data-streaming-hide-scroll={liveTurnActive || undefined} onScroll={scrollFollow.handleScroll} onWheel={scrollFollow.handleWheel} onTouchMove={scrollFollow.handleTouchMove} className="relative flex-1 overflow-x-hidden overflow-y-auto px-4 pt-4 pb-20">
          <div className="mx-auto max-w-[820px]">

            {(() => {
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
                  inStreamingViewport?: boolean;
                  afterContent?: React.ReactNode;
                  readFiles?: ReadFileInfo[];
                  turnDiffStats?: ToolDiffStats | null;
                  onOpenFile?: (filePath: string, fileName: string) => void;
                } = {},
              ): React.ReactNode => {
                const msg = opts.messageOverride ?? renderMessages[idx];
                const prevAssistantEntryId =
                  msg.role === "user" && idx > 0 && renderMessages[idx - 1].role === "assistant"
                    ? renderEntryIds[idx - 1]
                    : undefined;
                const isVisible = isVisibleChatMessage(msg);
                // The ref slot is the message's visible index, read from the
                // timeline projection instead of counted here.
                const currentRefIdx =
                  isVisible && opts.attachRef !== false ? timeline.visibleIndexOfSession(idx) : -1;
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
                    keywords={search.keywords}
                    highlightEntryId={search.highlightEntryId}
                    isSearchMatch={search.matchedEntryIds.has(renderEntryIds[idx])}
                    afterContent={opts.afterContent}
                    turnDuration={turnDurationMap.get(idx)}
                    readFiles={opts.readFiles}
                    turnDiffStats={opts.turnDiffStats}
                    onOpenFile={opts.onOpenFile}
                    cwd={session?.cwd ?? cwd}
                  />
                );
                if (currentRefIdx === -1) return view;
                return (
                  <div
                    key={key}
                    ref={(el) => {
                      messageRefs.current[currentRefIdx] = el;
                      if (idx === lastUserIdx) { (lastUserMsgRef as { current: HTMLDivElement | null }).current = el; }
                    }}
                    className={opts.inStreamingViewport ? "streaming-message-item" : undefined}
                  >
                    {view}
                  </div>
                );
              };

              // Group consecutive non-anchor messages into a foldable process
              // group. Each turn runs from an anchor (user message)
              // to the next anchor; intermediate assistant messages + the
              // process portion of the final assistant are collapsed by default.
              const rendered: React.ReactNode[] = [];
              const streamingRendered: React.ReactNode[] = [];
              // Read files of the in-progress turn: while the streaming message
              // viewport is up, these render below it (above the loading row)
              // instead of the final assistant footer.
              let streamingTurnReadFiles: ReadFileInfo[] = [];
              let streamingTurnDiffStats: ToolDiffStats | null = null;
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
                  (liveTurnActive && idx > lastUserIdx ? streamingRendered : rendered).push(
                    renderOne(idx, { inStreamingViewport: liveTurnActive && idx > lastUserIdx }),
                  );
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
                    (liveTurnActive && i > lastUserIdx ? streamingRendered : rendered).push(
                      renderOne(i, { inStreamingViewport: liveTurnActive && i > lastUserIdx }),
                    );
                  }
                  idx = endIdx;
                  continue;
                }

                // Turn-level files: collect every read / edit / write tool call
                // across this turn's assistant messages, dedupe by resolved path,
                // and drop errored results (read of a nonexistent path, failed
                // edit). Edit/write files carry their per-file added/deleted line
                // counts (from the tools' own data, no git). Surfaced as footer
                // chips on the final assistant message.
                const turnCwd = session?.cwd ?? cwd ?? null;
                const readFiles: ReadFileInfo[] = (() => {
                  const byPath = new Map<string, ReadFileInfo>();
                  const out: ReadFileInfo[] = [];
                  for (let i = userIdx + 1; i < endIdx; i++) {
                    const m = renderMessages[i];
                    if (m.role !== "assistant") continue;
                    for (const block of (m as AssistantMessage).content ?? []) {
                      if (block.type !== "toolCall") continue;
                      const tc = block as ToolCallContent;
                      const isRead = tc.toolName === "read";
                      const isMutate = tc.toolName === "edit" || tc.toolName === "write";
                      if (!isRead && !isMutate) continue;
                      const result = toolResultsMap.get(tc.toolCallId);
                      if (result?.isError) continue;
                      const raw = tc.input?.path;
                      if (typeof raw !== "string" || !raw.trim()) continue;
                      const resolved = resolveReadPath(raw.trim(), turnCwd);
                      if (!resolved) continue;
                      let diffStats: ToolDiffStats | null | undefined;
                      if (isMutate) {
                        diffStats = tc.toolName === "edit"
                          ? extractEditDiffStats(result?.details)
                          : extractWriteDiffStats(tc.input);
                      }
                      const existing = byPath.get(resolved);
                      if (existing) {
                        // Same file read and edited within the turn — merge:
                        // the chip stays read-first, stats attach when they land.
                        if (diffStats && !existing.diffStats) existing.diffStats = diffStats;
                        continue;
                      }
                      const entry: ReadFileInfo = { path: resolved, name: getFileName(resolved), diffStats };
                      byPath.set(resolved, entry);
                      out.push(entry);
                    }
                  }
                  return out;
                })();

                // Turn-level aggregate added/deleted line counts across this
                // turn's edit/write tool calls. Derived purely from the tools'
                // own data (edit: result details' diff payload; write: input
                // content) — never from git. Errored calls are skipped.
                const turnDiffStats: ToolDiffStats | null = (() => {
                  const parts: Array<ToolDiffStats | null | undefined> = [];
                  for (let i = userIdx + 1; i < endIdx; i++) {
                    const m = renderMessages[i];
                    if (m.role !== "assistant") continue;
                    for (const block of (m as AssistantMessage).content ?? []) {
                      if (block.type !== "toolCall") continue;
                      const tc = block as ToolCallContent;
                      if (tc.toolName !== "edit" && tc.toolName !== "write") continue;
                      const result = toolResultsMap.get(tc.toolCallId);
                      if (result?.isError) continue;
                      parts.push(
                        tc.toolName === "edit"
                          ? extractEditDiffStats(result?.details)
                          : extractWriteDiffStats(tc.input),
                      );
                    }
                  }
                  return sumDiffStats(parts);
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
                // process inline inside the live viewport instead of folding
                // it. Folding only kicks in once the turn is complete
                // (agentRunning flips back to false), so users see the full
                // think → tool-call → intermediate text flow as it streams,
                // then get a single collapsed summary at the end. Without
                // this, each message_end would re-mount the fold group with a
                // new key and snap it shut on every step.
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
                if (isCurrentTurnInProgress) {
                  streamingTurnReadFiles = readFiles;
                  streamingTurnDiffStats = turnDiffStats;
                }

                const processChildren = (
                  <Fragment>
                    {visibleProcessIndices.map((i) => (
                      <Fragment key={`proc-${i}`}>
                        {maybeDivider(i)}
                        {renderOne(i, {
                          keySuffix: "process",
                          inStreamingViewport: isCurrentTurnInProgress,
                        })}
                      </Fragment>
                    ))}
                  </Fragment>
                );

                if (processCount > 0) {
                  if (isCurrentTurnInProgress) {
                    streamingRendered.push(<Fragment key={`process-${userIdx}`}>{processChildren}</Fragment>);
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
                if (finalDiv) (isCurrentTurnInProgress ? streamingRendered : rendered).push(finalDiv);
                (isCurrentTurnInProgress ? streamingRendered : rendered).push(
                  renderOne(finalAssistantIdx, {
                    keySuffix: "answer",
                    // While this turn is streaming, the read-file chips move
                    // below the streaming viewport — not the footer here.
                    readFiles: isCurrentTurnInProgress ? undefined : readFiles,
                    turnDiffStats: isCurrentTurnInProgress ? undefined : turnDiffStats,
                    onOpenFile: handleOpenFileFromLibrary,
                    inStreamingViewport: isCurrentTurnInProgress,
                  }),
                );

                idx = endIdx;
              }
              return (
                <>
                  {rendered}
                  {liveTurnActive && (
                    <>
                      {(streamingStartedThisTurn || agentPhase !== null || streamingStoreHasContent) && (
                        <StreamingMessageViewport
                          tabId={streamingKey}
                          userScrollingUpRef={userScrolledUpRef}
                          onResumeAutoScroll={scrollFollow.handleResume}
                          onHeightIncrease={scrollFollow.handleHeightIncrease}
                        >
                          {streamingRendered}
                          {!streamingErrorAlreadyRendered && (
                            <StreamingBubble
                              tabId={streamingKey}
                              toolResults={toolResultsMap}
                              modelNames={modelNames}
                              modelIcons={modelIcons}
                              cwd={session?.cwd ?? cwd}
                            />
                          )}
                        </StreamingMessageViewport>
                      )}
                      {streamingStartedThisTurn && (streamingTurnReadFiles.length > 0 || streamingTurnDiffStats) && (
                        <div className="pb-1">
                          <ReadFileChips files={streamingTurnReadFiles} diffStats={streamingTurnDiffStats} onOpenFile={handleOpenFileFromLibrary} />
                        </div>
                      )}
                      <div className="py-2" style={{ height: 40, boxSizing: "border-box" }}>
                        {isStreamingThinking ? (
                          <LoadingState label={t("Thinking...")} variant="dot-pulse" />
                        ) : streamingStoreIsBody ? (
                          <LoadingState label={t("Outputting...")} variant="spark" />
                        ) : streamingStoreIsToolCall ? (
                          <LoadingState
                            label={phaseLabel(
                              agentPhase?.kind === "running_tools" && agentPhase.tools.length > 0
                                ? agentPhase
                                : {
                                    kind: "running_tools",
                                    tools: streamingToolCall
                                      ? [{ id: streamingToolCall.toolCallId, name: streamingToolCall.toolName, args: streamingToolCall.input }]
                                      : [],
                                  },
                              t,
                            )}
                            variant="rotor"
                          />
                        ) : agentRunning && !streamingStoreHasContent ? (
                          <LoadingState
                            label={phaseLabel(agentPhase, t)}
                            variant={phaseLoaderVariant(agentPhase)}
                          />
                        ) : null}
                      </div>
                    </>
                  )}
                </>
              );
            })()}

            {/* Ask User Questions form — lives in the message flow, right
                below the streaming message view (the form can only appear
                while a turn is in flight, so the viewport above is always
                present when it shows). The negative horizontal margins cancel
                this container's `px-4` so the panel's own 16px gutter keeps
                its 820px surface flush with the message column. */}
            <div style={{ margin: "0 -16px" }}>
              <AskUserQuestionsPanel
                sessionId={currentSessionId}
                onAppear={handleToBottom}
              />
            </div>

            {!liveTurnActive && !streamingErrorAlreadyRendered && (
              <StreamingBubble
                tabId={streamingKey}
                toolResults={toolResultsMap}
                modelNames={modelNames}
                modelIcons={modelIcons}
              />
            )}

            {/* Trailing compaction dividers — points whose `beforeMessageEntryId`
                doesn't exist yet (compaction just landed at the tail). Renders
                after the last message so a freshly compacted session shows
                the marker immediately, before the next user prompt. */}
            {optimisticCompactionMessageIdx === -1 && trailingCompactionPoints.map((point) => (
              <CompactionDivider key={`comp-tail-${point.entryId}`} point={point} />
            ))}

            {!liveTurnActive && isStreamingThinking && (
              <div className="py-2">
                <LoadingState label={t("Thinking...")} variant="dot-pulse" />
              </div>
            )}

            {!liveTurnActive && agentRunning && !streamingStoreHasContent && (
              <div className="py-2">
                <LoadingState
                  label={phaseLabel(agentPhase, t)}
                  variant={phaseLoaderVariant(agentPhase)}
                />
              </div>
            )}

            {!liveTurnActive && agentRunning && !streamingStoreHasContent && (
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
          {/* Session Library launcher (Q10A: second position). Always
              visible — empty state is shown inside the modal. Unread
              badge appears when entries land while the modal is closed. */}
          <SessionLibraryOpenButton
            count={sessionLibraryEntries.length}
            sessionId={currentSessionId}
          />
          <SubagentSessionsButton
            parentSessionId={session?.id ?? currentSessionId}
            refreshKey={subagentRefreshKey}
            onOpenSession={onOpenSession}
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
              disabled={!scrollFollow.showToBottom}
              aria-label={t("Scroll to bottom")}
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border shadow-lg transition-all duration-200 hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100"
              style={{
                background: "var(--bg-panel)",
                borderColor: "var(--border)",
                color: scrollFollow.showToBottom ? "var(--text-muted)" : "var(--text-dim)",
                opacity: scrollFollow.showToBottom ? 1 : 0.45,
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
            visible={search.visible}
            onJumpTo={search.handleJumpTo}
            onResultsChange={search.handleResultsChange}
            onClose={search.handleClose}
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
      {/* /model modal — portal'd into document.body; selection happens via
          handleModelChange (covers new-session and live-session paths).
          Rendered OUTSIDE the isEmptyNew ternary so it exists on both the
          new-session page and existing-session pages. On close, focus
          returns to the chat input for keyboard users. */}
      <ModelPickerModal
        open={modelModalOpen}
        model={displayModelValue}
        modelNames={modelNames}
        modelIcons={modelIcons}
        modelList={modelList}
        disabled={agentRunning}
        onModelChange={handleModelChange}
        onClose={() => {
          setModelModalOpen(false);
          chatInputRef?.current?.focus();
        }}
      />
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
