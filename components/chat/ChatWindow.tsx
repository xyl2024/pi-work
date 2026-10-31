"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMessage,
  SessionInfo,
  ReadFileInfo,
} from "@/lib/shared/types";
import { countToolCallsByName } from "@/lib/shared/message-display";
import {
  getChatBottomFrostMaskStyle,
  isChatBottomFrostMaskVisible,
} from "@/lib/shared/chatBottomFrostMask";
import { branchAnchorEntryId, buildChatTimeline, buildTimelineDividers, indexToolResults, isVisibleChatMessage } from "@/lib/shared/chat-timeline";
import { modelDisplayName } from "@/lib/shared/model-display";
import { summarizeTurn } from "@/lib/shared/tool-call-display";
import type { ToolDiffStats } from "@/lib/shared/tool-diff-stats";
import {
  canSwitchSessionPermissionMode,
  flippedPermissionMode,
  isPermissionMode,
  type PermissionMode,
} from "@/lib/shared/permission-mode";
import { MessageView, CollapseNonceProvider } from "./MessageView";
import { MessageCallMetricsProvider } from "./message-view/context";
import { useSessionCallMetrics } from "@/hooks/useSessionCallMetrics";
import { ReadFileChips } from "./ReadFileChips";
import { StreamingBubble } from "./StreamingBubble";
import { StreamingMessageViewport } from "./StreamingMessageViewport";
import { useIsStreamingBody, useIsStreamingError, useIsStreamingThinking, useIsStreamingToolCall, useStreamingHasContent, useStreamingToolCall } from "@/hooks/useStreamingMessage";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ModelPickerModal } from "./ModelPickerModal";
import { Tooltip } from "../ui/Tooltip";
import { usePendingAskUserQuestions } from "@/hooks/askUserQuestionsStore";
import { SubagentSessionsButton } from "./SubagentSessionsButton";
import { MoreActionsRow } from "./chat-window/MoreActionsRow";
import { AskUserQuestionsPanel } from "./AskUserQuestionsPanel";
import { ReplayBar } from "./ReplayBar";
import LoadingState from "../ui/LoadingState";
import { useAgentSession } from "@/hooks/useAgentSession";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import { CompactionDivider } from "./CompactionDivider";
import { ChangeDivider } from "./ChangeDivider";
import { setChatHeaderActions } from "@/hooks/chatHeaderActionsStore";
import type { SlashResource } from "@/lib/shared/slash-commands";
import { setToolCallScrollCallback } from "@/hooks/toolCallScrollStore";
import { setAgentControls } from "@/hooks/sessionUiStore";
import { SessionSearch } from "../sessions/SessionSearch";
import { phaseLabel, phaseLoaderVariant, resolveReadPath, isGroupAnchor, findFinalAssistantIndex, hasDisplayableProcessMessage } from "./chat-window/utils";
import { ProcessDetailsGroup } from "./chat-window/ProcessDetailsGroup";
import { NewSessionPresets } from "./chat-window/NewSessionPresets";
import { useAutoNaming } from "./chat-window/hooks/useAutoNaming";
import { useSessionNotifyBinding } from "./chat-window/hooks/useSessionNotifyBinding";
import { useSessionSearch } from "./chat-window/hooks/useSessionSearch";
import { useJumpHighlight } from "./chat-window/hooks/useJumpHighlight";
import { useReplay } from "./chat-window/hooks/useReplay";
import { useScrollFollow } from "./chat-window/hooks/useScrollFollow";
import { useTextSelection } from "@/hooks/useTextSelection";
import { TextSelectionToolbar } from "./text-selection-toolbar";

interface Props {
  tabId?: string;
  isActive?: boolean;
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onFirstAssistantReady?: () => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  scrollToEntryId?: string | null;
  onScrollComplete?: () => void;
  onNewSessionRequest?: () => void;
  onOpenSession: (sessionId: string) => void;
  cwd?: string | null;
  onCwdChange?: (cwd: string) => void;
  onRenameCompleted?: () => void;
  onSessionNameChange?: (name: string) => void;
  onSessionInfoLoaded?: (session: SessionInfo) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  onDraftChange?: (draft: {
    dirty: boolean;
    text: string;
    imageCount: number;
    cursorPosition: number;
  }) => void;
  onAgentStatusChange?: (status: {
    running: boolean;
    streaming: boolean;
    error: string | null;
  }) => void;
}

function ChatWindowContent({ tabId, isActive = true, session, newSessionCwd, onAgentEnd, onSessionCreated, onFirstAssistantReady, modelsRefreshKey, chatInputRef, scrollToEntryId, onScrollComplete, onNewSessionRequest, onOpenSession, cwd, onCwdChange, onRenameCompleted, onSessionNameChange, onSessionInfoLoaded, onOpenFile, onDraftChange, onAgentStatusChange }: Props) {
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

  const autoNameReadyRef = useRef<() => void>(() => {});
  const handleFirstAssistantReady = useCallback(() => {
    autoNameReadyRef.current();
  }, []);

  const entryNavigatedRef = useRef<() => void>(() => {});
  const handleEntryNavigated = useCallback(() => {
    entryNavigatedRef.current();
  }, []);

  const {
    data, loading, error, runtimeError, messages, entryIds, entryTimestamps, compactionPoints, changeMarkers, streamState,
    agentRunning, modelNames, modelIcons, modelIconPreferences, modelList, modelThinkingLevels, modelThinkingLevelMaps,
    toolSelection, availableTools, toolsLoading, toolsError, thinkingLevel, permissionMode,
    isBackgroundSession,
    retryInfo,
    displayModel: displayModelValue,
    agentPhase,
    subagentRefreshKey,
    isNew,
    messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef,
    handleSend, handleAbort, handleNavigate, handleModelChange,
    handleToolSelectionChange, ensureAvailableTools, handleThinkingLevelChange,
    handlePermissionModeChange,
    handleCompact,
    userMessageHistory,
    activeLeafId, currentSessionId,
    inFlightToolResults,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd, onSessionCreated, onFirstAssistantReady: handleFirstAssistantReady,
    modelsRefreshKey,
    scrollToEntryId,
    onEntryNavigated: handleEntryNavigated,
    isActive,
    controllerId: tabId,
  });

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

  const selection = useTextSelection(scrollContainerRef);
  const streamingStoreIsThinking = useIsStreamingThinking(streamingKey);
  const streamingStoreIsBody = useIsStreamingBody(streamingKey);
  const streamingStoreIsToolCall = useIsStreamingToolCall(streamingKey);
  const streamingToolCall = useStreamingToolCall(streamingKey);
  const streamingStoreIsError = useIsStreamingError(streamingKey);
  const streamingStoreHasContent = useStreamingHasContent(streamingKey);
  const handleQuoteSelection = useCallback((text: string) => {
    chatInputRef?.current?.insertText(`> ${text}\n\n`);
  }, [chatInputRef]);

  useEffect(() => {
    onAgentStatusChange?.({
      running: agentRunning,
      streaming: streamState.isStreaming,
      error: error ?? runtimeError,
    });
  }, [agentRunning, streamState.isStreaming, error, runtimeError, onAgentStatusChange]);

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

  const canSwitchPermissionMode = canSwitchSessionPermissionMode(
    permissionMode,
    isBackgroundSession,
  );

  useEffect(() => {
    if (!isActive) return;
    setAgentControls({
      abortStreaming: handleAbort,
      isStreaming: agentRunning,
      permissionMode,
      canChangePermissionMode: canSwitchPermissionMode,
      ...(canSwitchPermissionMode
        ? { setPermissionMode: (mode: PermissionMode) => handlePermissionModeChange(mode) }
        : {}),
    }, tabId);
    return () => setAgentControls(null, tabId);
  }, [isActive, agentRunning, permissionMode, canSwitchPermissionMode, tabId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingAskUserQuestions = usePendingAskUserQuestions(currentSessionId);
  const frostMaskVisible = isChatBottomFrostMaskVisible({ pendingAskUserQuestions: !!pendingAskUserQuestions });
  const frostMaskStyle = getChatBottomFrostMaskStyle();
  const handleOpenFile = useCallback(
    (filePath: string, fileName: string) => {
      if (onOpenFile) onOpenFile(filePath, fileName);
    },
    [onOpenFile],
  );

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
        try { filename = decodeURIComponent(mStar[1]); } catch {}
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
  useEffect(() => {
    entryNavigatedRef.current = scrollFollow.handleEntryNavigated;
  }, [scrollFollow.handleEntryNavigated]);

  const handleToBottom = scrollFollow.handleToBottom;
  const reengageScrollFollow = scrollFollow.handleExplicitScroll;

  const handleCompactClick = useCallback(async () => {
    if (!currentSessionId) return;
    if (agentRunning) {
      showToast({ kind: "error", message: t("Wait for the current turn to end before compacting.") });
      return;
    }
    handleToBottom();
    await handleCompact();
    handleToBottom();
  }, [currentSessionId, agentRunning, handleCompact, handleToBottom, showToast, t]);

  const [modelModalOpen, setModelModalOpen] = useState(false);

  const [collapseNonce, setCollapseNonce] = useState(0);
  const handleCollapseAll = useCallback(() => {
    setCollapseNonce((n) => n + 1);
  }, []);

  const onDrop = useCallback((files: File[]) => {
    chatInputRef?.current?.addImages(files);
  }, [chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const timeline = useMemo(
    () => buildChatTimeline({ messages, entryIds, entryTimestamps }),
    [messages, entryIds, entryTimestamps],
  );
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
  messageRefs.current = Array(timeline.visibleCount)
    .fill(null)
    .map((_, i) => messageRefs.current[i] ?? null);

  const search = useSessionSearch({
    isActive,
    sessionId: session?.id ?? null,
    timeline,
    scrollContainerRef,
    messageRefs,
    onExplicitScroll: reengageScrollFollow,
    onNavigate: handleNavigate,
  });

  const replay = useReplay({
    sessionId: session?.id ?? null,
    isStreaming: streamState.isStreaming,
    agentRunning,
    messages,
  });

  const renderSlice = timeline.sliceForReplay(replay.cropIndex);
  const renderMessages = renderSlice.messages;
  const renderEntryIds = renderSlice.entryIds;
  const renderEntryTimestamps = renderSlice.entryTimestamps;

  const toolResultsMap = useMemo(() => {
    const map = indexToolResults(messages);
    for (const [id, partial] of inFlightToolResults) {
      if (!map.has(id)) map.set(id, partial);
    }
    return map;
  }, [messages, inFlightToolResults]);

  const { beforeEntryId, trailingCompactionPoints, trailingChangeMarkers } = useMemo(() => {
    return buildTimelineDividers({
      timeline,
      entryIds: renderEntryIds,
      compactionPoints,
      changeMarkers,
    });
  }, [timeline, renderEntryIds, compactionPoints, changeMarkers]);

  const trailingChangeNodes = trailingChangeMarkers.map((marker) => (
    marker.kind === "model"
      ? (
        <ChangeDivider
          key={`change-tail-${marker.entryId}`}
          {...marker}
          modelName={modelDisplayName(modelNames, marker.provider, marker.modelId)}
        />
      )
      : <ChangeDivider key={`change-tail-${marker.entryId}`} {...marker} />
  ));

  const optimisticCompactionMessageIdx = useMemo(() => {
    if (trailingCompactionPoints.length === 0) return -1;
    const idx = renderEntryIds.length;
    return renderMessages[idx] ? idx : -1;
  }, [renderEntryIds, renderMessages, trailingCompactionPoints]);

  const trailingCompactionNodes = optimisticCompactionMessageIdx === -1
    ? trailingCompactionPoints.map((point) => (
        <CompactionDivider key={`comp-tail-${point.entryId}`} point={point} />
      ))
    : [];
  const trailingNodes = [...trailingCompactionNodes, ...trailingChangeNodes];

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

  const hasCollapsible = useMemo(
    () => renderMessages.some((m) => hasDisplayableProcessMessage(m) || (m.role === "assistant" && (m.content ?? []).some((b) => b.type === "thinking" || b.type === "toolCall"))),
    [renderMessages],
  );
  const collapseAllEnabled = hasCollapsible && !agentRunning;

  let lastUserIdx = -1;
  for (let i = renderMessages.length - 1; i >= 0; i--) {
    if (renderMessages[i].role === "user") { lastUserIdx = i; break; }
  }
  const liveTurnActive = agentRunning && agentPhase?.kind !== "compacting" && lastUserIdx !== -1;

  const lastUserTimestamp = lastUserIdx !== -1 ? renderMessages[lastUserIdx]?.timestamp : undefined;
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!agentRunning) {
      setTurnStartedAt(null);
      return;
    }
    setTurnStartedAt((prev) => prev ?? (typeof lastUserTimestamp === "number" ? lastUserTimestamp : Date.now()));
  }, [agentRunning, lastUserTimestamp]);
  const turnElapsedSince = agentPhase?.kind === "compacting" ? null : turnStartedAt;

  const [streamingStartedThisTurn, setStreamingStartedThisTurn] = useState(false);
  useEffect(() => {
    if (!liveTurnActive) {
      setStreamingStartedThisTurn(false);
    } else if (streamingStoreHasContent) {
      setStreamingStartedThisTurn(true);
    }
  }, [liveTurnActive, streamingStoreHasContent]);

  const { highlightEntryId: jumpHighlightEntryId, flash: flashJumpHighlight } = useJumpHighlight();
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
    const sessionIndex = timeline.sessionIndexOfVisible(idx);
    const entryId = sessionIndex === null ? null : renderEntryIds[sessionIndex] ?? null;
    flashJumpHighlight(entryId);
  }, [timeline, messageRefs, scrollContainerRef, reengageScrollFollow, renderEntryIds, flashJumpHighlight]);

  useEffect(() => {
    if (!isActive) return;
    setToolCallScrollCallback(handleScrollToToolCall, tabId);
    return () => setToolCallScrollCallback(null, tabId);
  }, [isActive, handleScrollToToolCall, tabId]);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;
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
  useEffect(() => {
    autoNameReadyRef.current = autoNameFirstAssistantReady;
  }, [autoNameFirstAssistantReady]);

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
    compactVisible: Boolean(session) && !agentRunning,
    isCompacting: agentPhase?.kind === "compacting",
    compactDisabled: agentRunning,
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

  const messageCallMetrics = useSessionCallMetrics(
    currentSessionId,
    `${agentRunning ? "run" : "idle"}:${messages.length}`,
  );

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
        if (controller.signal.aborted || (error as { name?: string }).name === "AbortError") return;
        console.error("Failed to load slash commands:", error);
        setSlashResources([]);
      }
    };

    void loadSlashResources();

    return () => controller.abort();
  }, [sessionId, newSessionCwd]);

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
        modelIconPreferences={modelIconPreferences}
        modelList={modelList}
        onModelChange={handleModelChange}
        toolSelection={toolSelection}
        availableTools={availableTools}
        toolsLoading={toolsLoading}
        toolsError={toolsError}
        onToolSelectionChange={handleToolSelectionChange}
        onEnsureAvailableTools={ensureAvailableTools}
        thinkingLevel={thinkingLevel}
        onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
        permissionMode={permissionMode}
        onPermissionModeToggle={canSwitchPermissionMode && isPermissionMode(permissionMode)
          ? () => {
              void handlePermissionModeChange(flippedPermissionMode(permissionMode));
            }
          : undefined}
        availableThinkingLevels={availableThinkingLevels}
        thinkingLevelMap={currentThinkingLevelMap}
        retryInfo={retryInfo}
        slashResources={slashResources}
        slashResourceKey={slashResourceKey}
        onSlashAction={(action) => {
          if (action === "new") onNewSessionRequest?.();
          else if (action === "compact") handleCompactClick();
          else if (action === "model") setModelModalOpen(true);
        }}
        sessionId={currentSessionId}
        userMessageHistory={userMessageHistory}
        onDraftChange={onDraftChange}
        cwd={cwd ?? null}
        onCwdChange={onCwdChange ?? (() => {})}
        showNotifyPicker={isEmptyNew}
        notifyChannelId={pickedChannelId}
        onNotifyChannelChange={setPickedChannelId}
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
      <MessageCallMetricsProvider value={messageCallMetrics}>
      <div className="relative flex flex-1 overflow-hidden">
        <div ref={scrollContainerRef} data-scroll-wide data-streaming-hide-scroll={liveTurnActive || undefined} onScroll={scrollFollow.handleScroll} onWheel={scrollFollow.handleWheel} onTouchMove={scrollFollow.handleTouchMove} className="relative flex-1 overflow-x-hidden overflow-y-auto px-4 pt-4 pb-20">
          <div className="mx-auto max-w-[820px]">

            {(() => {
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
                const anchorEntryId = branchAnchorEntryId(renderMessages, renderEntryIds, idx) ?? undefined;
                const isVisible = isVisibleChatMessage(msg);
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
                    modelIconPreferences={modelIconPreferences}
                    entryId={renderEntryIds[idx]}
                    onNavigate={agentRunning ? undefined : handleNavigate}
                    branchAnchorEntryId={agentRunning ? undefined : anchorEntryId}
                    onEditContent={(content) => chatInputRef?.current?.insertIfEmpty(content)}
                    showTimestamp={showTimestamp}
                    keywords={search.keywords}
                    highlightEntryId={jumpHighlightEntryId ?? search.highlightEntryId}
                    isSearchMatch={search.matchedEntryIds.has(renderEntryIds[idx])}
                    afterContent={opts.afterContent}
                    turnDuration={turnDurationMap.get(idx)}
                    readFiles={opts.readFiles}
                    turnDiffStats={opts.turnDiffStats}
                    onOpenFile={opts.onOpenFile}
                    cwd={session?.cwd ?? cwd}
                    sessionId={session?.id ?? null}
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

              const rendered: React.ReactNode[] = [];
              const streamingRendered: React.ReactNode[] = [];
              let streamingTurnReadFiles: ReadFileInfo[] = [];
              let streamingTurnDiffStats: ToolDiffStats | null = null;
              const maybeDivider = (idx: number): React.ReactNode => {
                const nodes: React.ReactNode[] = [];
                const entryId = renderEntryIds[idx];
                for (const divider of (entryId ? beforeEntryId.get(entryId) : undefined) ?? []) {
                  if (divider.kind === "compaction") {
                    nodes.push(<CompactionDivider key={`comp-${divider.point.entryId}`} point={divider.point} />);
                  } else {
                    const marker = divider.marker;
                    nodes.push(
                      marker.kind === "model"
                        ? (
                          <ChangeDivider
                            key={`change-${marker.entryId}`}
                            {...marker}
                            modelName={modelDisplayName(modelNames, marker.provider, marker.modelId)}
                          />
                        )
                        : <ChangeDivider key={`change-${marker.entryId}`} {...marker} />,
                    );
                  }
                }
                if (idx === optimisticCompactionMessageIdx) {
                  for (const pendingPoint of trailingCompactionPoints) {
                    nodes.push(<CompactionDivider key={`comp-tail-${pendingPoint.entryId}`} point={pendingPoint} />);
                  }
                }
                if (nodes.length === 0) return null;
                return <Fragment key={`dividers-${idx}`}>{nodes}</Fragment>;
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
                    const d = i === userIdx ? null : maybeDivider(i);
                    if (d) rendered.push(d);
                    (liveTurnActive && i > lastUserIdx ? streamingRendered : rendered).push(
                      renderOne(i, { inStreamingViewport: liveTurnActive && i > lastUserIdx }),
                    );
                  }
                  idx = endIdx;
                  continue;
                }

                const turnCwd = session?.cwd ?? cwd ?? null;
                const { readFiles, diffStats: turnDiffStats } = summarizeTurn(
                  renderMessages.slice(userIdx + 1, endIdx),
                  toolResultsMap,
                  turnCwd,
                  resolveReadPath,
                );

                rendered.push(renderOne(userIdx));

                const processIndices: number[] = [];
                for (let i = userIdx + 1; i < finalAssistantIdx; i++) processIndices.push(i);

                const visibleProcessIndices = processIndices.filter((i) =>
                  hasDisplayableProcessMessage(renderMessages[i]),
                );
                const processCount = visibleProcessIndices.length;

                const isCurrentTurnInProgress =
                  agentRunning &&
                  agentPhase?.kind !== "compacting" &&
                  userIdx === lastUserIdx &&
                  lastUserIdx !== -1;
                if (isCurrentTurnInProgress) {
                  streamingTurnReadFiles = readFiles;
                  streamingTurnDiffStats = turnDiffStats;
                }

                const renderProcessNode = (i: number) => (
                  <Fragment>
                    {maybeDivider(i)}
                    {renderOne(i, {
                      keySuffix: "process",
                      inStreamingViewport: isCurrentTurnInProgress,
                    })}
                  </Fragment>
                );

                if (processCount > 0) {
                  if (isCurrentTurnInProgress) {
                    streamingRendered.push(
                      <Fragment key={`process-${userIdx}`}>
                        {visibleProcessIndices.map((i) => (
                          <Fragment key={`proc-${i}`}>{renderProcessNode(i)}</Fragment>
                        ))}
                      </Fragment>,
                    );
                  } else {
                    rendered.push(
                      <ProcessDetailsGroup
                        key={`process-${userIdx}`}
                        turnDuration={{
                          startMs: renderMessages[userIdx].timestamp as number,
                          endMs: renderEntryTimestamps[finalAssistantIdx],
                        }}
                        items={visibleProcessIndices.map((i) => ({
                          key: `proc-${i}`,
                          toolCalls: countToolCallsByName(renderMessages, [i], []),
                          node: renderProcessNode(i),
                        }))}
                      />,
                    );
                  }
                }

                const finalDiv = maybeDivider(finalAssistantIdx);
                if (finalDiv) (isCurrentTurnInProgress ? streamingRendered : rendered).push(finalDiv);
                (isCurrentTurnInProgress ? streamingRendered : rendered).push(
                  renderOne(finalAssistantIdx, {
                    keySuffix: "answer",
                    readFiles: isCurrentTurnInProgress ? undefined : readFiles,
                    turnDiffStats: isCurrentTurnInProgress ? undefined : turnDiffStats,
                    onOpenFile: handleOpenFile,
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
                      {(streamingStartedThisTurn || agentPhase !== null || streamingStoreHasContent || trailingNodes.length > 0) && (
                        <StreamingMessageViewport
                          tabId={streamingKey}
                          userScrollingUpRef={userScrolledUpRef}
                          onResumeAutoScroll={scrollFollow.handleResume}
                          onHeightIncrease={scrollFollow.handleHeightIncrease}
                        >
                          {streamingRendered}
                          {trailingNodes}
                          {!streamingErrorAlreadyRendered && (
                            <StreamingBubble
                              tabId={streamingKey}
                              toolResults={toolResultsMap}
                              modelNames={modelNames}
                              modelIcons={modelIcons}
                              modelIconPreferences={modelIconPreferences}
                              cwd={session?.cwd ?? cwd}
                              onOpenFile={handleOpenFile}
                            />
                          )}
                        </StreamingMessageViewport>
                      )}
                      <div
                        className="py-2"
                        style={{ height: 40, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 12 }}
                      >
                        <div style={{ minWidth: 0, flexShrink: 1 }}>
                          {isStreamingThinking ? (
                            <LoadingState label={t("Thinking...")} variant="dot-pulse" elapsedSince={turnElapsedSince} />
                          ) : streamingStoreIsBody ? (
                            <LoadingState label={t("Outputting...")} variant="spark" elapsedSince={turnElapsedSince} />
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
                              elapsedSince={turnElapsedSince}
                            />
                          ) : agentRunning && !streamingStoreHasContent ? (
                            <LoadingState
                              label={phaseLabel(agentPhase, t)}
                              variant={phaseLoaderVariant(agentPhase)}
                              elapsedSince={turnElapsedSince}
                            />
                          ) : null}
                        </div>
                        {streamingStartedThisTurn && (streamingTurnReadFiles.length > 0 || streamingTurnDiffStats) && (
                          <div style={{ marginLeft: "auto", minWidth: 0 }}>
                            <ReadFileChips
                              files={streamingTurnReadFiles}
                              align="end"
                              diffStats={streamingTurnDiffStats}
                              onOpenFile={handleOpenFile}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              );
            })()}

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
                modelIconPreferences={modelIconPreferences}
                cwd={session?.cwd ?? cwd}
                onOpenFile={handleOpenFile}
                sessionId={session?.id ?? null}
              />
            )}

            {!liveTurnActive && trailingNodes}

            {!liveTurnActive && isStreamingThinking && (
              <div className="py-2">
                <LoadingState label={t("Thinking...")} variant="dot-pulse" elapsedSince={turnElapsedSince} />
              </div>
            )}

            {!liveTurnActive && agentRunning && !streamingStoreHasContent && (
              <div className="py-2">
                <LoadingState
                  label={phaseLabel(agentPhase, t)}
                  variant={phaseLoaderVariant(agentPhase)}
                  elapsedSince={turnElapsedSince}
                />
              </div>
            )}

            {!liveTurnActive && agentRunning && !streamingStoreHasContent && (
              <div style={{ height: 120 }} />
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {frostMaskVisible && <div aria-hidden className="chat-bottom-frost-mask" style={frostMaskStyle} />}

        {pendingAskUserQuestions ? null : (
        <div
          className="pointer-events-none absolute bottom-4 z-10 flex items-end gap-2"
          style={{ right: "max(16px, calc((100% - 820px) / 2))" }}
        >
          <MoreActionsRow />
          <SubagentSessionsButton
            parentSessionId={session?.id ?? currentSessionId}
            refreshKey={subagentRefreshKey}
            onOpenSession={onOpenSession}
            parentIsStreaming={agentRunning}
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
          <Tooltip content={t("Scroll to top")}>
            <button
              type="button"
              onClick={scrollFollow.handleToTop}
              disabled={scrollFollow.atTop}
              aria-label={t("Scroll to top")}
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border shadow-lg transition-all duration-200 hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100"
              style={{
                background: "var(--bg-panel)",
                borderColor: "var(--border)",
                color: scrollFollow.atTop ? "var(--text-dim)" : "var(--text-muted)",
                opacity: scrollFollow.atTop ? 0.45 : 1,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 10L8 6L12 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </Tooltip>
        </div>
        )}

      </div>
      </MessageCallMetricsProvider>
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
      </>
      )}
      <ModelPickerModal
        open={modelModalOpen}
        model={displayModelValue}
        modelNames={modelNames}
        modelIcons={modelIcons}
        modelIconPreferences={modelIconPreferences}
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
  return <ChatWindowContent {...props} />;
}
