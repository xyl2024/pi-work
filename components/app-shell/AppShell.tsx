"use client";

import { useState, useCallback, useMemo, useRef, useEffect, useReducer, memo, type RefObject, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSessionUiState, useSessionLeafChange } from "@/hooks/sessionUiStore";
import { initCwdList, useCwdList } from "@/hooks/cwdListStore";
import { SessionSidebar } from "../sessions/SessionSidebar";
import { ChatWindow } from "../chat/ChatWindow";
import { TextSelectionToolbar } from "../chat/text-selection-toolbar";
import { TranslateBubble } from "../chat/translate-bubble";
import { useTextSelection } from "@/hooks/useTextSelection";
import { SessionTabBar } from "../sessions/SessionTabBar";
import { FileViewer } from "../files/FileViewer";
import { TabBar } from "../ui/TabBar";
import { CollectionPanel } from "../sessions/CollectionPanel";
import { TranslatePanel } from "../panels/TranslatePanel";
import { TerminalPanel } from "../panels/TerminalPanel";
import { TokensPanel } from "../panels/TokensPanel";
import { LlmAuditPanel } from "../panels/LlmAuditPanel";
import { GitPanel } from "../panels/GitPanel";
import { McpPanel } from "../panels/McpPanel";
import { Tooltip } from "../ui/Tooltip";
import { SettingsModal } from "../settings/SettingsModal";

import { SchedulerPanel } from "../panels/SchedulerPanel";
import { ChannelsPanel } from "../panels/ChannelsPanel";
import { ConversationTreePanel } from "../sessions/ConversationTreePanel";
import { ModelsConfigPanel } from "../panels/ModelsConfigPanel";
import { ContextInsightPanel } from "../panels/ContextInsightPanel";
import { SkillsPanel } from "../panels/SkillsPanel";
import type { SessionTreeNode } from "@/lib/shared/types";
import { CommandPalette } from "./CommandPalette";
import { CwdPicker } from "../sessions/CwdPicker";
import { useI18n } from "@/hooks/useI18n";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useTheme } from "@/hooks/useTheme";
import { useDisableDefaultTab } from "@/hooks/useDisableDefaultTab";
import { useExternalLinks } from "@/hooks/useExternalLinks";
import { MorphToggleIcon } from "../ui/MorphToggleIcon";
import { ICONS } from "../ui/icons";
import { MENU, PANEL_LEFT } from "@/lib/client/icon-paths";
import { ExpandLeftIcon } from "../panels/right-bar/icons";
import { ExpandRightIcon } from "../ui/animated-icons";
import { useToast } from "../ui/Toast";
import { useContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import type { SessionInfo, SessionSearchResult } from "@/lib/shared/types";
import type { SessionUsageSummary } from "@/lib/shared/token-audit-types";
import { getRelativeFilePath } from "@/lib/shared/file-paths";
import { isRightBarButtonVisible } from "@/lib/shared/right-bar";
import {
  createPanelTabsState,
  panelButtonIdForKind,
  type AnyPanelTab,
  panelTabsReducer,
  selectActiveKind,
  selectActiveTab,
  selectCanExpand,
  selectOpenCount,
  selectTab,
  selectTabByKind,
  type PanelMode,
  type PanelViewKind,
} from "@/lib/shared/panelTabs";
import { useEnsureSettings } from "@/hooks/settingsStore";
import type { ChatInputHandle } from "../chat/ChatInput";
import { buildCommands, type Command, type CommandContext } from "@/lib/client/commands";
import { useAgentControls } from "@/hooks/sessionUiStore";
import { RightBarColumn } from "../panels/right-bar/RightBarColumn";
import { PANEL_COMMAND_ICON_BY_KIND, type RightBarCtx } from "../panels/right-bar/desc";
import { selectModelsConfigCloseConfirm } from "@/lib/shared/models-config-close";
import { selectSkillsCloseConfirm } from "@/lib/shared/skills-close";
import {
  schedulerPanel,
  setSchedulerPanelOpen,
  useSchedulerRunning,
} from "@/lib/client/scheduler-panel";
import { getModelsConfigDirty, releaseModelsConfigDraft, useModelsConfigDirty } from "@/lib/client/models-config-store";
import {
  cancelSkillInstall,
  getSkillInstallPhase,
  releaseSkillsState,
  useSkillInstallRunning,
} from "@/lib/client/skills-store";
import { channelsPanel } from "@/lib/client/channels-panel";
import {
  usePanelViewLifecycleSync,
  type PanelViewLifecycleStore,
} from "@/hooks/usePanelViewLifecycleSync";
import { getMcpDirty, releaseMcpState, useMcpDirty } from "@/lib/client/mcp-store";
import { selectMcpCloseConfirm } from "@/lib/shared/mcp-close";
import { subscribeModelsConfigSaved } from "@/lib/client/models-config-io";
import { cancelActiveOAuthLogins, hasActiveOAuthLogin } from "@/lib/client/oauth-login-store";
import { useRunningSessions } from "@/hooks/runningSessionsStore";
import { useConfirm } from "../ui/ConfirmDialog";
import { usePendingPermissions } from "@/hooks/usePendingPermissions";
import {
  APP_TITLE,
  createSessionWorkspaceState,
  getActiveSessionTab,
  getDocumentTitleForTab,
  getSessionTab,
  sessionWorkspaceReducer,
  type SessionTab,
  type SessionTabStatus,
  type SessionWorkspaceState,
} from "@/hooks/sessionWorkspaceStore";

interface PanelBodyCtx {
  rightPanelState: PanelMode;
  selectedSessionId: string | null;
  cwd: string | null;
  favoriteIds: string[];
  onSelectSession: (session: SessionInfo) => void;
  onToggleFavorite: (sessionId: string) => void;
  currentModel: { provider: string; modelId: string } | null;
  thinkingLevel: string;
  isStreaming: boolean;
  agentRunning: boolean;
  onConversationTreeCardClick: (cardId: string) => void;
  gitDiffOpenCount: number;
  onExpandGitPanel: () => void;
  openSessionById: (sessionId: string) => void;
  onNewSession: () => void;
  onClosePanelTab: () => void;
}

const PANEL_BODY_BY_KIND: Record<PanelViewKind, (ctx: PanelBodyCtx) => ReactNode> = {
  favorites: (ctx) => (
    <CollectionPanel
      favoriteIds={ctx.favoriteIds}
      onSelectSession={ctx.onSelectSession}
      onToggleFavorite={ctx.onToggleFavorite}
    />
  ),
  translate: () => <TranslatePanel />,
  tokens: () => <TokensPanel />,
  llmAudit: (ctx) => <LlmAuditPanel currentSessionId={ctx.selectedSessionId} />,
  context: (ctx) => (
    <ContextInsightPanel sessionId={ctx.selectedSessionId} visible={ctx.rightPanelState !== "closed"} />
  ),
  gitDiff: (ctx) => (
    <GitPanel
      cwd={ctx.cwd}
      openRefreshToken={ctx.gitDiffOpenCount}
      onExpandPanel={ctx.onExpandGitPanel}
      isPanelExpanded={ctx.rightPanelState === "expanded"}
    />
  ),
  conversationTree: (ctx) => (
    <ConversationTreePanel
      isStreaming={ctx.isStreaming}
      agentRunning={ctx.agentRunning}
      onCardClick={(card) => ctx.onConversationTreeCardClick(card.id)}
    />
  ),
  modelsConfig: (ctx) => <ModelsConfigPanel onCloseTab={ctx.onClosePanelTab} />,
  mcp: (ctx) => (
    <McpPanel
      cwd={ctx.cwd}
      visible={ctx.rightPanelState !== "closed"}
      onCloseTab={ctx.onClosePanelTab}
      onNewSession={ctx.onNewSession}
    />
  ),
  skills: (ctx) => <SkillsPanel cwd={ctx.cwd} onCloseTab={ctx.onClosePanelTab} />,
  scheduler: (ctx) => (
    <SchedulerPanel cwd={ctx.cwd} onOpenSession={ctx.openSessionById} onCloseTab={ctx.onClosePanelTab} />
  ),
  channels: (ctx) => <ChannelsPanel onCloseTab={ctx.onClosePanelTab} />,
};

interface PanelCloseGuard {
  titleKey: string;
  descriptionKey: string;
  confirmLabelKey: string;
}

const PANEL_CLOSE_GUARDS: Partial<Record<PanelViewKind, () => PanelCloseGuard | null>> = {
  modelsConfig: () =>
    selectModelsConfigCloseConfirm({
      dirty: getModelsConfigDirty(),
      oauthInProgress: hasActiveOAuthLogin(),
    }),
  skills: () => selectSkillsCloseConfirm({ installPhase: getSkillInstallPhase() }),
  mcp: () => selectMcpCloseConfirm({ dirty: getMcpDirty() }),
};

const PANEL_CLOSE_SIDE_EFFECTS: Partial<Record<PanelViewKind, () => void>> = {
  modelsConfig: () => {
    if (hasActiveOAuthLogin()) cancelActiveOAuthLogins();
  },
  skills: () => cancelSkillInstall(),
};

const PANEL_VIEW_STORES: readonly PanelViewLifecycleStore[] = [channelsPanel, schedulerPanel];

const PANEL_VIEW_STORE_BY_KIND: Partial<Record<PanelViewKind, PanelViewLifecycleStore>> = {
  channels: channelsPanel,
  scheduler: schedulerPanel,
};

const PANEL_KINDS_WITH_CLOSE_GUARD = [
  ...(Object.keys(PANEL_CLOSE_GUARDS) as PanelViewKind[]),
  ...(Object.keys(PANEL_VIEW_STORE_BY_KIND) as PanelViewKind[]),
];

function lossyPanelKinds(tabs: readonly AnyPanelTab[]): PanelViewKind[] {
  const closing = new Set(tabs.map((tab) => tab.kind));
  return PANEL_KINDS_WITH_CLOSE_GUARD.filter((kind) => closing.has(kind));
}

function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

function formatTtft(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
}

function formatTps(tps: number): string {
  return tps >= 100 ? tps.toFixed(0) : tps.toFixed(1);
}

const LEFT_PANEL_RATIO = 0.18;
const RIGHT_PANEL_RATIO = 0.32;

const TERMINAL_HEIGHT_KEY = "pi-terminal-panel-height";
const MIN_TERMINAL_HEIGHT = 80;
const MIN_CHAT_HEIGHT = 240;

function findDeepestLeafEntryId(
  entryId: string,
  roots: SessionTreeNode[],
): string | null {
  const byId = new Map<string, SessionTreeNode>();
  const walk = (n: SessionTreeNode): void => {
    byId.set(n.entry.id, n);
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  const start = byId.get(entryId);
  if (!start) return null;
  let deepest: SessionTreeNode = start;
  const stack: SessionTreeNode[] = [start];
  while (stack.length > 0) {
    const node = stack.pop()!;
    deepest = node;
    if (node.children.length > 0) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }
  return deepest.entry.id;
}

interface WorkspaceChatTabProps {
  tab: SessionTab;
  isActive: boolean;
  registerChatInputRef: (tabId: string, ref: RefObject<ChatInputHandle | null> | null) => void;
  onAgentEnd: (tabId: string) => void;
  onSessionCreated: (tabId: string, session: SessionInfo) => void;
  onSessionInfoLoaded: (tabId: string, session: SessionInfo) => void;
  onFirstAssistantReady: (tabId: string) => void;
  modelsRefreshKey: number;
  scrollToEntryId: string | null;
  onScrollComplete: () => void;
  onNewSessionRequest: (cwdOverride?: string) => void;
  onOpenSession: (sessionId: string) => void;
  onCwdChange: (cwd: string) => void;
  onRenameCompleted: () => void;
  onSessionNameChange: (tabId: string, name: string) => void;
  onOpenFile: (filePath: string, fileName: string) => void;
  onDraftChange: (tabId: string, draft: { dirty: boolean }) => void;
  onAgentStatusChange: (tabId: string, status: { running: boolean; streaming: boolean; error: string | null }) => void;
}

function WorkspaceChatTabView({
  tab,
  isActive,
  registerChatInputRef,
  onAgentEnd,
  onSessionCreated,
  onSessionInfoLoaded,
  onFirstAssistantReady,
  modelsRefreshKey,
  scrollToEntryId,
  onScrollComplete,
  onNewSessionRequest,
  onOpenSession,
  onCwdChange,
  onRenameCompleted,
  onSessionNameChange,
  onOpenFile,
  onDraftChange,
  onAgentStatusChange,
}: WorkspaceChatTabProps) {
  const chatInputRef = useRef<ChatInputHandle | null>(null);

  useEffect(() => {
    registerChatInputRef(tab.tabId, chatInputRef);
    return () => registerChatInputRef(tab.tabId, null);
  }, [registerChatInputRef, tab.tabId]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: isActive ? "block" : "none",
        overflow: "hidden",
      }}
    >
      <ChatWindow
        tabId={tab.tabId}
        isActive={isActive}
        session={tab.kind === "session" ? tab.session : null}
        newSessionCwd={tab.kind === "draft" ? tab.cwd : null}
        onAgentEnd={() => onAgentEnd(tab.tabId)}
        onSessionCreated={(session) => onSessionCreated(tab.tabId, session)}
        onSessionInfoLoaded={(session) => onSessionInfoLoaded(tab.tabId, session)}
        onFirstAssistantReady={() => onFirstAssistantReady(tab.tabId)}
        modelsRefreshKey={modelsRefreshKey}
        chatInputRef={chatInputRef}
        scrollToEntryId={scrollToEntryId}
        onScrollComplete={onScrollComplete}
        onNewSessionRequest={onNewSessionRequest}
        onOpenSession={onOpenSession}
        cwd={tab.session?.cwd ?? tab.cwd}
        onCwdChange={onCwdChange}
        onRenameCompleted={onRenameCompleted}
        onSessionNameChange={(name) => onSessionNameChange(tab.tabId, name)}
        onOpenFile={onOpenFile}
        onDraftChange={(draft) => onDraftChange(tab.tabId, draft)}
        onAgentStatusChange={(status) => onAgentStatusChange(tab.tabId, status)}
      />
    </div>
  );
}

const WorkspaceChatTab = memo(WorkspaceChatTabView, (previous, next) =>
  previous.tab === next.tab &&
  previous.isActive === next.isActive &&
  previous.modelsRefreshKey === next.modelsRefreshKey &&
  previous.scrollToEntryId === next.scrollToEntryId
);

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, setLocale } = useI18n();
  const { formatCost } = useFormatCurrency();
  const theme = useTheme();
  const toast = useToast();
  useDisableDefaultTab();
  useExternalLinks();
  const cm = useContextMenu();
  const settings = useEnsureSettings();
  const rightSideBarConfig = settings?.right_side_bar ?? null;
  const { cwds: recentCwds } = useCwdList();
  const [panelTabsState, dispatchPanelTabs] = useReducer(
    panelTabsReducer,
    undefined,
    createPanelTabsState,
  );
  const panelTabsRef = useRef(panelTabsState);
  panelTabsRef.current = panelTabsState;
  const rightPanelState = panelTabsState.mode;
  const setPanelMode = useCallback((mode: PanelMode) => {
    dispatchPanelTabs({ type: "set_mode", mode });
  }, []);
  const openTabs = panelTabsState.tabs;
  const activeFileTabId = panelTabsState.activeId;
  const activePanelTab = selectActiveTab(panelTabsState);
  const activeRightPanelKind = selectActiveKind(panelTabsState);
  const gitDiffOpenCount = selectOpenCount(panelTabsState, "gitDiff");

  useEffect(() => {
    initCwdList();
  }, []);

  const [initialSessionId] = useState<string | null>(() => searchParams.get("session"));
  const [workspace, dispatchWorkspace] = useReducer(
    sessionWorkspaceReducer,
    initialSessionId,
    (sessionId): SessionWorkspaceState => createSessionWorkspaceState({
      withDraft: !sessionId,
      draftId: "draft:initial",
    }),
  );
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const activeTab = getActiveSessionTab(workspace);
  const documentTitle = getDocumentTitleForTab(activeTab);
  useEffect(() => {
    document.title = documentTitle;
    return () => {
      document.title = APP_TITLE;
    };
  }, [documentTitle]);
  const selectedSession = activeTab?.kind === "session" ? activeTab.session : null;
  const newSessionCwd = activeTab?.kind === "draft" ? activeTab.cwd : null;
  const activeTabId = workspace.activeTabId;
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingScrollEntryIds, setPendingScrollEntryIds] = useState<Record<string, string | null>>({});
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [settingsConfigOpen, setSettingsConfigOpen] = useState(false);
  const [cwdPickerOpen, setCwdPickerOpen] = useState(false);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const chatInputRefs = useRef<Map<string, RefObject<ChatInputHandle | null>>>(new Map());
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelSelection = useTextSelection(rightPanelRef);
  const confirm = useConfirm();
  const { setActiveSessionId: setActivePermissionSession, removeSessionRequests: removeSessionPermissionRequests } = usePendingPermissions();

  const modelsConfigDirty = useModelsConfigDirty();
  const modelsConfigTabOpen = selectTabByKind(panelTabsState, "modelsConfig") !== null;
  useEffect(() => {
    if (!modelsConfigTabOpen) releaseModelsConfigDraft();
  }, [modelsConfigTabOpen]);
  const skillsInstalling = useSkillInstallRunning();
  const skillsTabOpen = selectTabByKind(panelTabsState, "skills") !== null;
  useEffect(() => {
    if (!skillsTabOpen) releaseSkillsState();
  }, [skillsTabOpen]);
  const schedulerRunning = useSchedulerRunning();
  useEffect(() => {
    setSchedulerPanelOpen(activeRightPanelKind === "scheduler" && rightPanelState !== "closed");
  }, [activeRightPanelKind, rightPanelState]);
  usePanelViewLifecycleSync(panelTabsState, PANEL_VIEW_STORES);
  const mcpDirty = useMcpDirty();
  const mcpTabOpen = selectTabByKind(panelTabsState, "mcp") !== null;
  useEffect(() => {
    if (!mcpTabOpen) releaseMcpState();
  }, [mcpTabOpen]);
  useEffect(() => subscribeModelsConfigSaved(() => setModelsRefreshKey((k) => k + 1)), []);

  useEffect(() => {
    setActivePermissionSession(selectedSession?.id ?? null);
  }, [selectedSession?.id, setActivePermissionSession]);

  const agentControls = useAgentControls();

  const openPalette = useCallback(() => {
    setSettingsConfigOpen(false);
    setPaletteOpen(true);
  }, []);
  const closeTopPanel = useCallback(() => {}, []);

  const { branchTree, branchActiveLeafId, isStreaming, agentRunning, currentModel, thinkingLevel } = useSessionUiState();
  const handleBranchLeafChange = useSessionLeafChange();

  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/favorites")
      .then((r) => r.json())
      .then((d: { sessionIds?: string[] }) => {
        if (Array.isArray(d.sessionIds)) setFavoriteIds(d.sessionIds);
      })
      .catch(() => {});
  }, []);
  const toggleSessionFavorite = useCallback(async (sessionId: string) => {
    const prev = favoriteIds;
    const next = prev.includes(sessionId)
      ? prev.filter((id) => id !== sessionId)
      : [...prev, sessionId];
    setFavoriteIds(next);
    try {
      const res = await fetch("/api/favorites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionIds: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setFavoriteIds(prev);
      toast.show({ kind: "error", message: t("Failed to update favorite") });
    }
  }, [favoriteIds, t, toast]);

  const leftWidth = `${LEFT_PANEL_RATIO * 100}%`;
  const rightWidth = `${RIGHT_PANEL_RATIO * 100}%`;

  const getActiveChatInput = useCallback(() => {
    if (!activeTabId) return null;
    return chatInputRefs.current.get(activeTabId)?.current ?? null;
  }, [activeTabId]);

  const handleRightPanelQuote = useCallback((text: string) => {
    getActiveChatInput()?.insertText(`> ${text}\n\n`);
  }, [getActiveChatInput]);

  const handleAtMention = useCallback((filePath: string) => {
    const cwd = selectedSession?.cwd ?? newSessionCwd;
    const displayPath = cwd ? getRelativeFilePath(filePath, cwd) : filePath;
    getActiveChatInput()?.insertText(displayPath);
  }, [getActiveChatInput, selectedSession?.cwd, newSessionCwd]);

  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);

  const handleCwdPicked = useCallback((cwd: string) => {
    if (!cwd || !activeTabId) return;
    if (activeTab?.kind === "draft") {
      if (cwd !== activeTab.cwd) {
        dispatchWorkspace({ type: "set_draft_cwd", tabId: activeTabId, cwd });
      }
      return;
    }
    const draft = workspaceRef.current.tabOrder
      .map((id) => workspaceRef.current.tabs[id])
      .find((tab) => tab.kind === "draft");
    if (draft) {
      dispatchWorkspace({ type: "set_draft_cwd", tabId: draft.tabId, cwd });
      dispatchWorkspace({ type: "activate", tabId: draft.tabId });
    } else {
      dispatchWorkspace({ type: "ensure_draft", cwd });
    }
    closeTopPanel();
  }, [activeTab, activeTabId, closeTopPanel]);

  useEffect(() => {
    if (!initialSessionRestored) return;
    const draft = workspace.tabOrder
      .map((id) => workspace.tabs[id])
      .find((tab) => tab.kind === "draft");
    if (!draft || draft.cwd || !recentCwds?.[0]) return;
    dispatchWorkspace({ type: "set_draft_cwd", tabId: draft.tabId, cwd: recentCwds[0] });
  }, [initialSessionRestored, recentCwds, workspace.tabOrder, workspace.tabs]);

  const handleSelectSession = useCallback((
    session: SessionInfo,
    isRestoreOrScroll?: boolean | string | null,
    scrollEntryId?: string | null,
  ) => {
    const targetScrollEntryId = scrollEntryId ?? (typeof isRestoreOrScroll === "string" ? isRestoreOrScroll : null);
    dispatchWorkspace({ type: "open_session", session });
    setInitialSessionRestored(true);
    if (targetScrollEntryId) {
      const knownTab = getSessionTab(workspaceRef.current, session.id);
      const tabId = knownTab?.tabId ?? `session:${session.id}`;
      setPendingScrollEntryIds((prev) => ({ ...prev, [tabId]: targetScrollEntryId }));
    }
    closeTopPanel();
  }, [closeTopPanel]);

  const handleSelectSearchResult = useCallback((result: SessionSearchResult) => {
    const sessionInfo: SessionInfo = {
      path: "",
      id: result.id,
      cwd: result.cwd,
      name: result.name,
      created: result.modified,
      modified: result.modified,
      messageCount: 0,
      firstMessage: "",
      running: false,
    };
    handleSelectSession(sessionInfo, false, result.firstMatchEntryId ?? null);
  }, [handleSelectSession]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string) => {
    if (!cwd) return;
    const current = workspaceRef.current;
    const draft = current.tabOrder
      .map((id) => current.tabs[id])
      .find((tab) => tab.kind === "draft");
    if (draft) {
      if (draft.cwd !== cwd) dispatchWorkspace({ type: "set_draft_cwd", tabId: draft.tabId, cwd });
      dispatchWorkspace({ type: "activate", tabId: draft.tabId });
    } else {
      dispatchWorkspace({ type: "ensure_draft", cwd });
    }
    closeTopPanel();
  }, [closeTopPanel]);

  const handleLogout = useCallback(() => {
    void fetch("/api/auth/session/logout", { method: "POST" })
      .catch(() => undefined)
      .finally(() => { window.location.href = "/login"; });
  }, []);

  const handleSlashNew = useCallback((cwdOverride?: string) => {
    const cwd = cwdOverride ?? selectedSession?.cwd ?? newSessionCwd;
    if (!cwd) return;
    handleNewSession("draft", cwd);
  }, [selectedSession?.cwd, newSessionCwd, handleNewSession]);

  const handleSessionCreated = useCallback((tabId: string, session: SessionInfo) => {
    dispatchWorkspace({ type: "upgrade_draft", tabId, session });
  }, []);

  const handleOpenScheduledSession = useCallback((sessionId: string) => {
    dispatchWorkspace({ type: "open_session_by_id", sessionId });
    closeTopPanel();
  }, [closeTopPanel]);

  const handleAgentEnd = useCallback((tabId?: string) => {
    setRefreshKey((k) => k + 1);
    if (!tabId || tabId === workspaceRef.current.activeTabId) {
      setExplorerRefreshKey((k) => k + 1);
    }
  }, []);

  const handleFirstAssistantReady = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSessionNameChange = useCallback((tabId: string, name: string) => {
    const tab = workspaceRef.current.tabs[tabId];
    if (tab?.sessionId) {
      dispatchWorkspace({ type: "update_session", sessionId: tab.sessionId, patch: { name } });
    }
  }, []);
  const handleSessionRenameCompleted = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);
  const handleSidebarSessionRenamed = useCallback((sessionId: string, name: string) => {
    dispatchWorkspace({ type: "update_session", sessionId, patch: { name } });
  }, []);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
    if (workspaceRef.current.tabOrder.length === 0) {
      dispatchWorkspace({ type: "ensure_draft", cwd: recentCwds?.[0] ?? null });
    }
  }, [recentCwds]);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((k) => k + 1);
    dispatchWorkspace({ type: "close_session", sessionId });
    removeSessionPermissionRequests(sessionId);
    closeTopPanel();
  }, [closeTopPanel, removeSessionPermissionRequests]);

  const handleDraftChange = useCallback((tabId: string, draft: { dirty: boolean }) => {
    dispatchWorkspace({ type: "set_dirty", tabId, dirty: draft.dirty });
  }, []);

  const handleAgentStatusChange = useCallback((tabId: string, status: { running: boolean; error: string | null }) => {
    const current = workspaceRef.current;
    const tab = current.tabs[tabId];
    if (!tab) return;
    const nextStatus: SessionTabStatus = status.error
      ? "error"
      : status.running
        ? "running"
        : current.activeTabId === tabId
          ? "idle"
          : tab.status === "running"
            ? "completed"
            : tab.status;
    dispatchWorkspace({ type: "set_status", tabId, status: nextStatus });
  }, []);

  const handleActivateSessionTab = useCallback((tabId: string) => {
    const tab = workspaceRef.current.tabs[tabId];
    if (!tab) return;
    dispatchWorkspace({ type: "activate", tabId });
    if (tab.status === "completed") {
      dispatchWorkspace({ type: "set_status", tabId, status: "idle" });
    }
  }, []);

  const handleCloseSessionTab = useCallback(async (tabId: string) => {
    const tab = workspaceRef.current.tabs[tabId];
    if (!tab) return;
    if (tab.dirty) {
      const ok = await confirm({
        title: t("Close draft?"),
        description: t("This tab has unsent text or images. They will be lost."),
        confirmLabel: t("Discard"),
        cancelLabel: t("Cancel"),
        destructive: true,
      });
      if (!ok) return;
    }
    dispatchWorkspace({ type: "close", tabId });
    setPendingScrollEntryIds((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    chatInputRefs.current.delete(tabId);
  }, [confirm, t]);

  const handleBatchCloseSessionTabs = useCallback(async (tabId: string, mode: "left" | "right" | "others") => {
    const current = workspaceRef.current;
    const index = current.tabOrder.indexOf(tabId);
    if (index === -1) return;
    const ids = mode === "left" ? current.tabOrder.slice(0, index) : mode === "right" ? current.tabOrder.slice(index + 1) : current.tabOrder.filter((id) => id !== tabId);
    const dirtyCount = ids.filter((id) => current.tabs[id]?.dirty).length;
    if (dirtyCount > 0) {
      const ok = await confirm({ title: t("Close drafts?"), description: t("Some tabs have unsent text or images. They will be lost."), confirmLabel: t("Discard"), cancelLabel: t("Cancel"), destructive: true });
      if (!ok) return;
    }
    for (const id of ids) {
      dispatchWorkspace({ type: "close", tabId: id });
      setPendingScrollEntryIds((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      chatInputRefs.current.delete(id);
    }
  }, [confirm, t]);
  const registerChatInputRef = useCallback((tabId: string, ref: RefObject<ChatInputHandle | null> | null) => {
    if (ref) chatInputRefs.current.set(tabId, ref);
    else chatInputRefs.current.delete(tabId);
  }, []);

  const [reloadCounters, setReloadCounters] = useState<Record<string, number>>({});
  const handleReloadSessionTab = useCallback((tabId: string) => {
    const tab = workspaceRef.current.tabs[tabId];
    if (!tab || tab.kind !== "session") return;
    setReloadCounters((prev) => ({ ...prev, [tabId]: (prev[tabId] ?? 0) + 1 }));
    toast.show({ kind: "info", message: t("Refreshed") });
  }, [t, toast]);

  useEffect(() => {
    if (!initialSessionRestored) return;
    const sessionId = activeTab?.sessionId ?? null;
    const current = searchParams.get("session");
    if (current === sessionId) return;
    const target = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "/";
    router.replace(target, { scroll: false });
  }, [activeTab?.sessionId, initialSessionRestored, router, searchParams]);

  const handleOpenFile = useCallback((filePath: string, fileName: string) => {
    dispatchPanelTabs({ type: "open_file", path: filePath, label: fileName });
  }, []);

  const handleTogglePanel = useCallback((kind: PanelViewKind) => {
    dispatchPanelTabs({ type: "toggle", kind });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const active = document.activeElement;
      const isEditable =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (mod && e.key === "b" && !e.altKey) {
        if (!isEditable) {
          e.preventDefault();
          setSidebarOpen((v) => !v);
        }
        return;
      }
      if (mod && e.altKey && e.key === "b") {
        e.preventDefault();
        dispatchPanelTabs({
          type: "set_mode",
          mode: panelTabsRef.current.mode === "closed" ? "normal" : "closed",
        });
        return;
      }
      if (mod && e.key === "k") {
        e.preventDefault();
        if (paletteOpen) {
          setPaletteOpen(false);
        } else {
          openPalette();
        }
        return;
      }
      if (
        e.key === " " &&
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        !paletteOpen &&
        getActiveChatInput()
      ) {
        if (!isEditable) {
          e.preventDefault();
          getActiveChatInput()?.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [paletteOpen, openPalette, getActiveChatInput]);

  const handleConversationTreeCardClick = useCallback((cardId: string) => {
    if (agentRunning) return;
    const targetLeafId = findDeepestLeafEntryId(cardId, branchTree) ?? cardId;
    if (branchActiveLeafId !== targetLeafId) {
      handleBranchLeafChange(targetLeafId);
    }
  }, [agentRunning, branchActiveLeafId, branchTree, handleBranchLeafChange]);

  const handleExpandGitPanel = useCallback(() => {
    setPanelMode("expanded");
  }, [setPanelMode]);

  const askPanelClose = useCallback(
    async (guard: {
      titleKey: string;
      descriptionKey: string;
      confirmLabelKey: string;
    }): Promise<boolean> =>
      confirm({
        title: t(guard.titleKey),
        description: t(guard.descriptionKey),
        confirmLabel: t(guard.confirmLabelKey),
        cancelLabel: t("Cancel"),
        destructive: true,
      }),
    [confirm, t],
  );

  const confirmDropPanelTabs = useCallback(
    async (kinds: readonly PanelViewKind[]): Promise<boolean> => {
      const closingStores: PanelViewLifecycleStore[] = [];
      const confirmedKinds: PanelViewKind[] = [];
      for (const kind of kinds) {
        const store = PANEL_VIEW_STORE_BY_KIND[kind];
        if (store) {
          const guard = store.guard();
          if (guard && !(await askPanelClose(guard))) return false;
          closingStores.push(store);
          continue;
        }
        const guard = PANEL_CLOSE_GUARDS[kind]?.();
        if (guard && !(await askPanelClose(guard))) return false;
        confirmedKinds.push(kind);
      }
      for (const store of closingStores) await store.requestClose(() => true);
      for (const kind of confirmedKinds) PANEL_CLOSE_SIDE_EFFECTS[kind]?.();
      return true;
    },
    [askPanelClose],
  );

  const handleCloseFileTab = useCallback(async (tabId: string) => {
    const tab = selectTab(panelTabsState, tabId);
    if (!(await confirmDropPanelTabs(lossyPanelKinds(tab ? [tab] : [])))) return;
    dispatchPanelTabs({ type: "close", id: tabId });
  }, [panelTabsState, confirmDropPanelTabs]);

  const handleCloseLeftTabs = useCallback(async (tabId: string) => {
    const index = panelTabsState.tabs.findIndex((tab) => tab.id === tabId);
    const drops = index > 0 ? panelTabsState.tabs.slice(0, index) : [];
    if (!(await confirmDropPanelTabs(lossyPanelKinds(drops)))) return;
    dispatchPanelTabs({ type: "close_left", id: tabId });
  }, [panelTabsState, confirmDropPanelTabs]);

  const handleCloseRightTabs = useCallback(async (tabId: string) => {
    const index = panelTabsState.tabs.findIndex((tab) => tab.id === tabId);
    const drops = panelTabsState.tabs.slice(index + 1);
    if (!(await confirmDropPanelTabs(lossyPanelKinds(drops)))) return;
    dispatchPanelTabs({ type: "close_right", id: tabId });
  }, [panelTabsState, confirmDropPanelTabs]);

  const handleCloseOtherTabs = useCallback(async (tabId: string) => {
    const drops = panelTabsState.tabs.filter((tab) => tab.id !== tabId);
    if (!(await confirmDropPanelTabs(lossyPanelKinds(drops)))) return;
    dispatchPanelTabs({ type: "close_others", id: tabId });
  }, [panelTabsState, confirmDropPanelTabs]);

  const handleTabContextMenu = useCallback((tabId: string, x: number, y: number, triggerElement: HTMLElement | null) => {
    const idx = openTabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const hasLeft = idx > 0;
    const hasRight = idx < openTabs.length - 1;
    const hasOthers = openTabs.length > 1;
    const items: ContextMenuItem[] = [
      { key: "close", label: t("Close tab"), onSelect: () => handleCloseFileTab(tabId) },
      { key: "close-left", label: t("Close tabs to the left"), onSelect: () => handleCloseLeftTabs(tabId), disabled: !hasLeft },
      { key: "close-right", label: t("Close tabs to the right"), onSelect: () => handleCloseRightTabs(tabId), disabled: !hasRight },
      { key: "close-others", label: t("Close other tabs"), onSelect: () => handleCloseOtherTabs(tabId), disabled: !hasOthers },
    ];
    cm.open({ x, y, items, triggerElement });
  }, [openTabs, t, cm, handleCloseFileTab, handleCloseLeftTabs, handleCloseRightTabs, handleCloseOtherTabs]);

  const handleFileDeleted = useCallback((filePath: string) => {
    dispatchPanelTabs({ type: "close_files_under", path: filePath });
  }, []);

  const showChat = initialSessionRestored && workspace.tabOrder.length > 0;

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);

  const [terminalHeight, setTerminalHeight] = useState<number>(() => {
    if (typeof window === "undefined") return 200;
    try {
      const v = Number(localStorage.getItem(TERMINAL_HEIGHT_KEY));
      const maxH = Math.max(MIN_TERMINAL_HEIGHT, window.innerHeight - 60 - MIN_CHAT_HEIGHT);
      if (Number.isFinite(v) && v >= MIN_TERMINAL_HEIGHT && v <= maxH) return v;
    } catch {
    }
    return 200;
  });

  useEffect(() => {
    try {
      localStorage.setItem(TERMINAL_HEIGHT_KEY, String(terminalHeight));
    } catch {
    }
  }, [terminalHeight]);

  const toggleTerminal = useCallback(() => {
    setTerminalOpen((v) => !v);
  }, []);

  useEffect(() => {
    if (!terminalOpen) setTerminalFullscreen(false);
  }, [terminalOpen]);

  const selectedSessionId = selectedSession?.id ?? null;
  const selectedCwd = selectedSession?.cwd ?? newSessionCwd ?? null;
  const [statusBar, setStatusBar] = useState<{
    os: string;
    shell: string;
    channels: number;
    git: { branch: string | null; changedFiles: number; additions: number; deletions: number };
    today: { tokens: number; cost: number };
    session: SessionUsageSummary | null;
  }>({
    os: "—",
    shell: "—",
    channels: 0,
    git: { branch: null, changedFiles: 0, additions: 0, deletions: 0 },
    today: { tokens: 0, cost: 0 },
    session: null,
  });
  const { count: runningSessionCount } = useRunningSessions();

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const params = new URLSearchParams();
        if (selectedCwd) params.set("cwd", selectedCwd);
        if (selectedSessionId) params.set("sessionId", selectedSessionId);
        const query = params.toString();
        const response = await fetch(`/api/status-bar${query ? `?${query}` : ""}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setStatusBar(data);
      } catch {
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedCwd, selectedSessionId]);

  const rightBarCtx: RightBarCtx = {
    rightPanelState,
    activeTabKind: activeRightPanelKind,
    selectedSessionId,
    selectedCwd,
    modelsConfigDirty,
    skillsInstalling,
    schedulerRunning,
    mcpDirty,
    t,
    toggleRightPanel: () =>
      setPanelMode(rightPanelState === "closed" ? "normal" : "closed"),
    togglePanel: handleTogglePanel,
  };
  const panelBodyCtx: PanelBodyCtx = {
    rightPanelState,
    selectedSessionId,
    cwd: selectedCwd,
    favoriteIds,
    onSelectSession: handleSelectSession,
    onToggleFavorite: toggleSessionFavorite,
    currentModel,
    thinkingLevel,
    isStreaming,
    agentRunning,
    onConversationTreeCardClick: handleConversationTreeCardClick,
    gitDiffOpenCount,
    onExpandGitPanel: handleExpandGitPanel,
    openSessionById: handleOpenScheduledSession,
    onNewSession: handleSlashNew,
    onClosePanelTab: () => {
      if (activeFileTabId) handleCloseFileTab(activeFileTabId);
    },
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key === "`") {
        e.preventDefault();
        setTerminalOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const startTerminalDrag = useCallback(
    (startY: number) => {
      const startH = terminalHeight;
      const onMove = (ev: MouseEvent) => {
        const next = startH - (ev.clientY - startY);
        const maxH = Math.max(MIN_TERMINAL_HEIGHT, window.innerHeight - 60 - MIN_CHAT_HEIGHT);
        setTerminalHeight(Math.min(Math.max(next, MIN_TERMINAL_HEIGHT), maxH));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [terminalHeight],
  );

  const terminalDefaultCwd = useMemo(() => {
    const sessionCwd = selectedSession?.cwd ?? newSessionCwd;
    if (sessionCwd) return sessionCwd;
    try {
      return localStorage.getItem("pi-terminal-cwd") || "~";
    } catch {
      return "~";
    }
  }, [selectedSession, newSessionCwd]);

  useEffect(() => {
    if (rightPanelState === "closed") return;
    if (activeRightPanelKind === null) return;
    const id = panelButtonIdForKind(activeRightPanelKind);
    if (id === null) return;
    if (isRightBarButtonVisible(rightSideBarConfig, id)) return;
    setPanelMode("closed");
  }, [rightPanelState, activeRightPanelKind, rightSideBarConfig, setPanelMode]);

  const commandContext = useMemo<CommandContext>(() => ({
    setTheme: theme.setPreset,
    setLocale,
    newSession: handleSlashNew,
    openSettings: () => setSettingsConfigOpen(true),
    openCwdPicker: () => setCwdPickerOpen(true),
    toggleSidebar: () => setSidebarOpen((v) => !v),
    toggleRightPanel: () => dispatchPanelTabs({
      type: "set_mode",
      mode: panelTabsRef.current.mode === "closed" ? "normal" : "closed",
    }),
    togglePanel: handleTogglePanel,
    agentControls,
    hasSession: selectedSession !== null || newSessionCwd !== null,
  }), [
    theme.setPreset, setLocale, handleSlashNew,
    setCwdPickerOpen,
    handleTogglePanel,
    agentControls,
    selectedSession, newSessionCwd,
  ]);

  const commands = useMemo<Command[]>(
    () => buildCommands(commandContext, t, PANEL_COMMAND_ICON_BY_KIND),
    [commandContext, t],
  );

  const sidebarToggleLeading = (
    <Tooltip content={sidebarOpen ? t("Hide sidebar") : t("Show sidebar")}>
      <button
        type="button"
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label={sidebarOpen ? t("Hide sidebar") : t("Show sidebar")}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          padding: 0,
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          flexShrink: 0,
          transition: "color 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
      >
        <MorphToggleIcon from={MENU} to={PANEL_LEFT} active={sidebarOpen} />
      </button>
    </Tooltip>
  );

  const showExpandPanelLeading = selectCanExpand(panelTabsState);

  const expandPanelLeading = showExpandPanelLeading ? (
    <Tooltip content={rightPanelState === "expanded" ? t("Collapse panel") : t("Expand panel")}>
      <button
        type="button"
        onClick={() => setPanelMode(rightPanelState === "expanded" ? "normal" : "expanded")}
        aria-label={rightPanelState === "expanded" ? t("Collapse panel") : t("Expand panel")}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          padding: 0,
          background: "none",
          border: "none",
          color: rightPanelState === "expanded" ? "var(--accent)" : "var(--text-muted)",
          cursor: "pointer",
          flexShrink: 0,
          transition: "color 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = rightPanelState === "expanded" ? "var(--accent)" : "var(--text-muted)"; }}
      >
        {rightPanelState === "expanded" ? <ExpandLeftIcon /> : <ExpandRightIcon size={16} />}
      </button>
    </Tooltip>
  ) : null;

  const chatHiddenByTerminalFullscreen = terminalFullscreen;
  const chatCard = (
    <div
      style={{
        flex: chatHiddenByTerminalFullscreen ? "0 0 0%" : "1 1 0%",
        minHeight: chatHiddenByTerminalFullscreen ? 0 : MIN_CHAT_HEIGHT,
        display: chatHiddenByTerminalFullscreen ? "none" : "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: "var(--panel-radius)",
        border: "1px solid var(--panel-border)",
        background: "var(--bg)",
      }}
    >
      {showChat && (
        <SessionTabBar
          leadingControl={sidebarToggleLeading}
          tabs={workspace.tabOrder.map((tabId) => workspace.tabs[tabId]).filter((tab): tab is SessionTab => Boolean(tab))}
          activeTabId={activeTabId}
          onSelectTab={handleActivateSessionTab}
          onCloseTab={(tabId) => { void handleCloseSessionTab(tabId); }}
          onBatchClose={(tabId, mode) => { void handleBatchCloseSessionTabs(tabId, mode); }}
          onReload={handleReloadSessionTab}
          onReorder={(tabId, toIndex) => dispatchWorkspace({ type: "reorder", tabId, toIndex })}
          onNewSession={() => handleSlashNew()}
        />
      )}

      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {showChat && workspace.tabOrder.map((tabId) => {
          const tab = workspace.tabs[tabId];
          if (!tab) return null;
          return (
            <WorkspaceChatTab
              key={`${tab.tabId}:${reloadCounters[tab.tabId] ?? 0}`}
              tab={tab}
              isActive={tab.tabId === activeTabId}
              registerChatInputRef={registerChatInputRef}
              onAgentEnd={handleAgentEnd}
              onSessionCreated={handleSessionCreated}
              onSessionInfoLoaded={(_tabId, session) => dispatchWorkspace({ type: "open_session", session, activate: false })}
              onFirstAssistantReady={handleFirstAssistantReady}
              modelsRefreshKey={modelsRefreshKey}
              scrollToEntryId={pendingScrollEntryIds[tab.tabId] ?? null}
              onScrollComplete={() => setPendingScrollEntryIds((prev) => {
                if (!(tab.tabId in prev)) return prev;
                const next = { ...prev };
                delete next[tab.tabId];
                return next;
              })}
              onNewSessionRequest={handleSlashNew}
              onOpenSession={handleOpenScheduledSession}
              onCwdChange={handleCwdPicked}
              onRenameCompleted={handleSessionRenameCompleted}
              onSessionNameChange={handleSessionNameChange}
              onOpenFile={handleOpenFile}
              onDraftChange={handleDraftChange}
              onAgentStatusChange={handleAgentStatusChange}
            />
          );
        })}
      </div>
    </div>
  );

  const panelCard = (
    <>
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "transparent", height: 34, borderRadius: "var(--panel-radius) var(--panel-radius) 0 0", overflow: "hidden", padding: "0 6px", gap: 2 }}>
        {expandPanelLeading && (
          <div style={{ flexShrink: 0, display: "flex", alignItems: "stretch" }}>
            {expandPanelLeading}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <TabBar
            tabs={openTabs}
            activeTabId={activeFileTabId ?? ""}
            onSelectTab={(tabId) => {
              dispatchPanelTabs({ type: "activate", id: tabId });
            }}
            onCloseTab={(tabId) => {
              handleCloseFileTab(tabId);
            }}
            onContextMenu={handleTabContextMenu}
          />
        </div>
      </div>

      <div ref={rightPanelRef} style={{ flex: 1, overflow: "hidden" }}>
        {activePanelTab === null ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("No file open")}
          </div>
        ) : activePanelTab.kind === "file" ? (
          <FileViewer
            filePath={activePanelTab.params.path}
            cwd={selectedSession?.cwd ?? newSessionCwd ?? undefined}
            rightPanelState={rightPanelState}
          />
        ) : (
          PANEL_BODY_BY_KIND[activePanelTab.kind](panelBodyCtx)
        )}
      </div>
    </>
  );

  const sidebarContent = (
    <SessionSidebar
      selectedSession={selectedSession}
      selectedSessionId={selectedSession?.id ?? null}
      onSelectSession={handleSelectSession}
      initialSessionId={initialSessionId}
      onInitialRestoreDone={handleInitialRestoreDone}
      refreshKey={refreshKey}
      onSessionDeleted={handleSessionDeleted}
      onSessionRenamed={handleSidebarSessionRenamed}
      onNewSession={handleSlashNew}
      selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
      onOpenFile={handleOpenFile}
      explorerRefreshKey={explorerRefreshKey}
      onAtMention={handleAtMention}
      onOpenSearch={openPalette}
      onFileDeleted={handleFileDeleted}
      favoriteIds={favoriteIds}
      onToggleFavorite={toggleSessionFavorite}
      onOpenSettings={() => setSettingsConfigOpen(true)}
      onLogout={handleLogout}
      profileRefreshKey={profileRefreshKey}
    />
  );

  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - env(titlebar-area-height, 0px))", overflow: "hidden", padding: "var(--panel-padding)", paddingBottom: 4, border: "1px solid var(--border)", borderTop: "none", background: "var(--bg)" }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <div
        className="sidebar-overlay-backdrop"
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.4)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      <div
        className={`sidebar-container${sidebarOpen ? "" : " sidebar-closed"}`}
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--panel-border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 200,
          width: sidebarOpen ? leftWidth : 0,
          minWidth: sidebarOpen ? leftWidth : 0,
        }}
      >
          {sidebarContent}
      </div>

      <div style={{ flex: rightPanelState === "expanded" ? "0 1 0%" : "1 1 0%", display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, gap: terminalOpen && !terminalFullscreen ? "var(--panel-gap-stack)" : 0, transition: "flex-grow 0.18s cubic-bezier(0.32, 0.72, 0, 1), gap 0.18s ease" }}>
        {chatCard}

        <div
          onMouseDown={(e) => {
            e.preventDefault();
            startTerminalDrag(e.clientY);
          }}
          title={t("Drag to resize")}
          aria-hidden
          style={{
            flexShrink: 0,
            height: terminalOpen && !terminalFullscreen ? 5 : 0,
            cursor: terminalOpen && !terminalFullscreen ? "ns-resize" : "default",
            pointerEvents: terminalOpen && !terminalFullscreen ? "auto" : "none",
            background: "transparent",
            transition: "height 0.2s ease",
          }}
        />

        <div
          style={{
            flexShrink: terminalFullscreen ? 1 : 0,
            flexGrow: terminalFullscreen ? 1 : 0,
            flexBasis: terminalFullscreen ? 0 : (terminalOpen ? terminalHeight : 0),
            minHeight: 0,
            overflow: "hidden",
            border: terminalOpen ? "1px solid var(--panel-border)" : "none",
            borderRadius: terminalOpen ? "var(--panel-radius)" : 0,
            background: "var(--bg)",
            display: "flex",
            flexDirection: "column",
            transition: "flex-basis 0.2s ease, flex-grow 0.2s ease",
          }}
        >
          <TerminalPanel
            defaultCwd={terminalDefaultCwd}
            open={terminalOpen}
            fullscreen={terminalFullscreen}
            onToggleFullscreen={() => setTerminalFullscreen((value) => !value)}
            onClosePanel={() => {
              setTerminalFullscreen(false);
              setTerminalOpen(false);
            }}
          />
        </div>
      </div>

      <div
        className={`right-panel-container right-panel-${rightPanelState}`}
        style={{
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--panel-border)",
          background: "var(--bg)",
          width: rightPanelState === "closed" ? 0 : rightWidth,
          minWidth: rightPanelState === "closed" ? 0 : rightWidth,
        }}
      >
        {panelCard}
      </div>

      </div>

      <div
        style={{
          flexShrink: 0,
          minHeight: 20,
          display: "flex",
          alignItems: "center",
          padding: "0 2px",
          border: "none",
          borderRadius: "var(--panel-radius)",
          background: "var(--bg)",
          color: "var(--text-muted)",
          fontSize: 11,
          lineHeight: 1,
          marginTop: 4,
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          onClick={toggleTerminal}
          aria-label={t("Toggle terminal")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
            border: "none",
            borderRadius: 6,
            background: "transparent",
            color: terminalOpen ? "var(--accent)" : "inherit",
            padding: "2px 0",
            margin: 0,
            font: "inherit",
            lineHeight: 1,
            whiteSpace: "nowrap",
            cursor: "pointer",
            transition: "background-color 0.12s ease",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "color-mix(in srgb, var(--accent) 12%, transparent)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "transparent";
          }}
        >
          <ICONS.terminalBox size={12} />
          {statusBar.os} : {statusBar.shell}
        </button>
        {statusBar.git.branch != null && (
        <button
          type="button"
          onClick={() => handleTogglePanel("gitDiff")}
          aria-label={t("Open git diff")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
            border: "none",
            borderRadius: 6,
            background: "transparent",
            color: "inherit",
            padding: "2px 0",
            margin: "0 0 0 10px",
            font: "inherit",
            lineHeight: 1,
            cursor: "pointer",
            transition: "background-color 0.12s ease",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "transparent";
          }}
        >
          <ICONS.gitBranch size={12} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            {statusBar.git.branch}
            {statusBar.git.additions > 0 && <span style={{ color: "#16a34a" }}>+{statusBar.git.additions}</span>}
            {statusBar.git.deletions > 0 && <span style={{ color: "#ef4444" }}>-{statusBar.git.deletions}</span>}
          </span>
        </button>
        )}
        <span style={{ marginLeft: 10 }}>Active: <span style={{ color: runningSessionCount > 0 ? "var(--accent)" : "inherit" }}>{runningSessionCount}</span></span>
        <span style={{ marginLeft: 10 }}>{t("Channels")}: {statusBar.channels}</span>
        {statusBar.session && (() => {
          const usage = statusBar.session;
          if (
            usage.totalTokens === 0 &&
            usage.costTotal === 0 &&
            usage.avgTtftMs === null &&
            usage.avgGenerationTps === null
          ) {
            return null;
          }
          const items: Array<{ key: string; title: string; label: string; value: string }> = [
            { key: "in", title: t("Input tokens with cache"), label: t("In"), value: formatTokenCount(usage.inputTokensWithCache) },
            { key: "out", title: t("Output tokens"), label: t("Out"), value: formatTokenCount(usage.outputTokens) },
            { key: "total", title: t("Total tokens"), label: t("Total"), value: formatTokenCount(usage.totalTokens) },
            { key: "cost", title: t("Total cost"), label: t("Cost"), value: formatCost(usage.costTotal) },
            {
              key: "cache",
              title: t("Cache hit rate"),
              label: t("Cache"),
              value: usage.cacheHitRate === null ? "—" : `${Math.round(usage.cacheHitRate * 100)}%`,
            },
            {
              key: "ttft",
              title: t("Avg TTFT"),
              label: t("TTFT"),
              value: usage.avgTtftMs === null ? "—" : formatTtft(usage.avgTtftMs),
            },
            {
              key: "tps",
              title: t("Avg TPS"),
              label: t("TPS"),
              value: usage.avgGenerationTps === null ? "—" : formatTps(usage.avgGenerationTps),
            },
          ];
          return items.map((item) => (
            <Tooltip key={item.key} content={item.title}>
              <span style={{ marginLeft: 10, whiteSpace: "nowrap" }}>
                {item.label} {item.value}
              </span>
            </Tooltip>
          ));
        })()}
        <span style={{ marginLeft: "auto" }}>
          Today: {statusBar.today.tokens.toString().replace(/\B(?=(\d{4})+(?!\d))/g, ",")} tokens ${statusBar.today.cost.toFixed(4)}
        </span>
      </div>
      </div>

      <RightBarColumn cfg={rightSideBarConfig} ctx={rightBarCtx} />
    </div>

  </div>
    {settingsConfigOpen && <SettingsModal onClose={() => setSettingsConfigOpen(false)} onProfileSaved={() => setProfileRefreshKey((k) => k + 1)} />}
    <CwdPicker
      cwd={selectedSession?.cwd ?? newSessionCwd ?? null}
      onCwdChange={handleCwdPicked}
      openSignal={cwdPickerOpen}
      onOpenSignalHandled={() => setCwdPickerOpen(false)}
      hideTrigger
    />
    <CommandPalette
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      cwd={selectedSession?.cwd ?? newSessionCwd ?? null}
      onSelectSession={handleSelectSearchResult}
      commands={commands}
      t={t}
    />
    <TextSelectionToolbar
      state={rightPanelSelection}
      onQuote={handleRightPanelQuote}
      onHide={rightPanelSelection.hide}
    />
    <TranslateBubble />
    </>
  );
}
