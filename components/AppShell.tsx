"use client";

import { useState, useCallback, useMemo, useRef, useEffect, useReducer, memo, type RefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSessionUiState, useSessionLeafChange } from "@/hooks/sessionUiStore";
import { initCwdList, useCwdList } from "@/hooks/cwdListStore";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow } from "./ChatWindow";
import { SessionTabBar } from "./SessionTabBar";
import { FileViewer } from "./FileViewer";
import { TabBar, type Tab } from "./TabBar";
import { TodoPanel } from "./user-todo/TodoPanel";

// Right panel content re-renders only when its inputs change. TodoPanel has
// no props, so memoizing it keeps AppShell's per-state-change re-renders
// (e.g. collapsing the panel) from re-rendering the whole todo list — that
// synchronous re-render on every click was the main source of the janky
// collapse/expand animation (the ~200ms main-thread block ate the transition
// frames).
const MemoTodoPanel = memo(TodoPanel);
import { CollectionPanel } from "./CollectionPanel";
import { TranslatePanel } from "./TranslatePanel";
import { ToolCallStatsPanel } from "./ToolCallStatsPanel";
import { JsonPanel } from "./JsonPanel";
import { CanvasPanel } from "./CanvasPanel";
import { RssPanel } from "./RssPanel";
import { TerminalPanel } from "./TerminalPanel";
import { TokensPanel } from "./TokensPanel";
import { LlmAuditPanel } from "./LlmAuditPanel";
import { GitDiffPanel } from "./GitDiffPanel";
import { useToolCallStatsView, useToolCallStatsScroll } from "@/hooks/toolCallStatsStore";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { Tooltip } from "./Tooltip";
import { PromptsConfig } from "./PromptsConfig";
import { SettingsModal } from "./SettingsModal";

import { SchedulerModal } from "./Scheduler";
import { ConversationTreePanel } from "./ConversationTreePanel";
import type { SessionTreeNode } from "@/lib/types";
import { CommandPalette } from "./CommandPalette";
import { InboxModal } from "./InboxModal";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useInboxUnreadCount } from "@/hooks/useInboxUnreadCount";
import { useRssUnreadCount } from "@/hooks/useRssUnreadCount";
import { MorphToggleIcon } from "./MorphToggleIcon";
import { MENU, PANEL_LEFT } from "@/lib/icon-paths";
import { useToast } from "./Toast";
import { useContextMenu, type ContextMenuItem } from "./ContextMenu";
import type { SessionInfo, SessionSearchResult } from "@/lib/types";
import {
  TODO_TAB_ID,
  FAVORITES_TAB_ID,
  TRANSLATE_TAB_ID,
  TOOL_CALLS_TAB_ID,
  JSON_TAB_ID,
  CANVAS_TAB_ID,
  RSS_TAB_ID,
  TOKENS_TAB_ID,
  GIT_DIFF_TAB_ID,
  CONVERSATION_TREE_TAB_ID,
  LLM_AUDIT_TAB_ID,
  CONTEXT_TAB_ID,
  RIGHT_BAR_ID_FOR_TAB_KIND,
} from "@/lib/types";
import { isRightBarButtonVisible } from "@/lib/right-bar";
import { useEnsureSettings } from "@/hooks/settingsStore";
import type { ChatInputHandle } from "./ChatInput";
import { sendAgentCommand } from "@/lib/agent-client";
import { buildCommands, type Command, type CommandContext } from "@/lib/commands";
import { useAgentControls } from "@/hooks/sessionUiStore";
import { RightBarColumn } from "./rightBar/RightBarColumn";
import type { RightBarCtx } from "./rightBar/desc";
import { useGitStatusStore } from "@/lib/git-status-store";
import { useConfirm } from "./ConfirmDialog";
import { usePendingPermissions } from "@/hooks/usePendingPermissions";
import {
  createSessionWorkspaceState,
  getActiveSessionTab,
  getSessionTab,
  sessionWorkspaceReducer,
  type SessionTab,
  type SessionTabStatus,
  type SessionWorkspaceState,
} from "@/hooks/sessionWorkspaceStore";

interface ToolInfo {
  name: string;
  description: string;
  active: boolean;
}

// Fixed panel ratios (drag-resize removed). Center column takes the remainder.
const LEFT_PANEL_RATIO = 0.18;
const RIGHT_PANEL_RATIO = 0.32;

// Bottom terminal panel geometry.
const TERMINAL_HEIGHT_KEY = "pi-terminal-panel-height";
const TERMINAL_LOCATION_KEY = "pi-terminal-panel-location";
const TERMINAL_TAB_ID = "terminal:global";
const MIN_TERMINAL_HEIGHT = 80;

// True while settings haven't been fetched (or the fetch failed).
// Until then, all right-bar buttons render as visible — the conservative
// default that matches the on-disk default config. (The helper itself
// lives in lib/config so SettingsModal can reuse it.)

// Walk the entry tree starting at `entryId` and return the entry id of the
// deepest leaf reachable from it. A leaf is any entry whose `children` list
// is empty. If `entryId` isn't found in the tree we return null so the
// caller can fall back to the original id. This is what lets us map "click
// on this card" to "switch to the END of that card's branch" — we never
// stop the navigation at an ancestor card just because the user happened
// to click higher up in the tree.
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
      // Push in reverse so the leftmost branch is popped first.
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }
  return deepest.entry.id;
}

// Split a fully-assembled system prompt into "Pi base + Append" segments and
// "<project_instructions path=...>...</project_instructions>" segments — the
// pi SDK wraps each AGENTS.md file in those tags, so they're our only reliable
// per-source boundary in the rendered string. Each AGENTS.md segment is then
// colored differently in the System panel.
type SystemPromptSegment =
  | { kind: "base"; text: string }
  | { kind: "agents"; path: string; text: string };

// Color palette for AGENTS.md segments. Loops if there are more files than colors.
const AGENTS_SEGMENT_COLORS = [
  "#3b82f6", // blue
  "#a855f7", // purple
  "#ec4899", // pink
  "#f59e0b", // amber
  "#10b981", // emerald
  "#06b6d4", // cyan
];

function splitSystemPrompt(systemPrompt: string): SystemPromptSegment[] {
  const segments: SystemPromptSegment[] = [];
  const re = /<project_instructions path="([^"]+)">([\s\S]*?)<\/project_instructions>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(systemPrompt)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "base", text: systemPrompt.slice(lastIndex, match.index) });
    }
    // pi's buildSystemPrompt wraps content as `<tag>\n${content}\n</tag>`;
    // strip the wrapper-introduced leading/trailing newlines so the rendered
    // segment matches the original file rather than the assembly scaffolding.
    segments.push({ kind: "agents", path: match[1], text: match[2].replace(/^\n+|\n+$/g, "") });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < systemPrompt.length) {
    segments.push({ kind: "base", text: systemPrompt.slice(lastIndex) });
  }
  return segments;
}

interface WorkspaceChatTabProps {
  tab: SessionTab;
  isActive: boolean;
  registerChatInputRef: (tabId: string, ref: RefObject<ChatInputHandle | null> | null) => void;
  onAgentEnd: (tabId: string) => void;
  onSessionCreated: (tabId: string, session: SessionInfo) => void;
  onFirstAssistantReady: (tabId: string) => void;
  modelsRefreshKey: number;
  scrollToEntryId: string | null;
  onScrollComplete: () => void;
  onNewSessionRequest: (cwdOverride?: string) => void;
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
  onFirstAssistantReady,
  modelsRefreshKey,
  scrollToEntryId,
  onScrollComplete,
  onNewSessionRequest,
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
        onFirstAssistantReady={() => onFirstAssistantReady(tab.tabId)}
        modelsRefreshKey={modelsRefreshKey}
        chatInputRef={chatInputRef}
        scrollToEntryId={scrollToEntryId}
        onScrollComplete={onScrollComplete}
        onNewSessionRequest={onNewSessionRequest}
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
  const theme = useTheme();
  const toast = useToast();
  const cm = useContextMenu();
  const { unread: inboxUnread } = useInboxUnreadCount();
  const { unread: rssUnread } = useRssUnreadCount();
  const settings = useEnsureSettings();
  const rightSideBarConfig = settings?.right_side_bar ?? null;
  const { cwds: recentCwds } = useCwdList();

  // Fetch the recent-cwd list exactly once at app start (shared with the
  // CwdPicker, which never refetches on open or remount).
  useEffect(() => {
    initCwdList();
  }, []);

  useEffect(() => {
    if (window.parent === window) return;

    const styles = getComputedStyle(document.documentElement);
    window.parent.postMessage({
      type: "pi-theme",
      colors: {
        background: styles.getPropertyValue("--bg-panel").trim(),
        border: styles.getPropertyValue("--border").trim(),
        text: styles.getPropertyValue("--text").trim(),
      },
    }, "*");
  }, [theme.preset]);

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
  const selectedSession = activeTab?.kind === "session" ? activeTab.session : null;
  const newSessionCwd = activeTab?.kind === "draft" ? activeTab.cwd : null;
  const activeTabId = workspace.activeTabId;
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingScrollEntryIds, setPendingScrollEntryIds] = useState<Record<string, string | null>>({});
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
  const [promptsConfigOpen, setPromptsConfigOpen] = useState(false);
  const [settingsConfigOpen, setSettingsConfigOpen] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const chatInputRefs = useRef<Map<string, RefObject<ChatInputHandle | null>>>(new Map());
  const confirm = useConfirm();
  const { setActiveSessionId: setActivePermissionSession } = usePendingPermissions();

  useEffect(() => {
    setActivePermissionSession(selectedSession?.id ?? null);
  }, [selectedSession?.id, setActivePermissionSession]);

  // ── Command palette: agent controls bridge ──
  // ChatWindow registers these on mount via the sessionUiStore (null when
  // no session is mounted).
  const agentControls = useAgentControls();

  const openPalette = useCallback(() => {
    // The palette is the top-level modal — opening it closes every other
    // modal so the screen never stacks. Sidebar button + ⌘K both route here.
    setModelsConfigOpen(false);
    setSkillsConfigOpen(false);
    setPromptsConfigOpen(false);
    setSettingsConfigOpen(false);
    setSchedulerOpen(false);
    setInboxOpen(false);
    setPaletteOpen(true);
  }, []);
  const closeTopPanel = useCallback(() => {}, []);

  // Session-level UI state (branch tree, system prompt, stats, context usage)
  // is owned by each tab controller. Only the active controller projects its
  // snapshot into this module-level bridge for the chat footer/right panels.
  const { branchTree, branchActiveLeafId, systemPrompt, isStreaming, agentRunning } = useSessionUiState();
  const handleBranchLeafChange = useSessionLeafChange();

  // Tools are cached per formal session. Activating an already-open tab only
  // reads this map; it never sends a new runtime request just because focus
  // moved between tabs.
  const [toolsBySession, setToolsBySession] = useState<Record<string, ToolInfo[]>>({});
  const toolsFetchedRef = useRef<Set<string>>(new Set());
  const tools = selectedSession ? toolsBySession[selectedSession.id] ?? [] : [];

  const fetchTools = useCallback(async (sessionId: string) => {
    if (toolsFetchedRef.current.has(sessionId)) return;
    toolsFetchedRef.current.add(sessionId);
    try {
      const result = await sendAgentCommand<ToolInfo[]>(sessionId, { type: "get_tools" });
      setToolsBySession((prev) => ({ ...prev, [sessionId]: result ?? [] }));
    } catch {
      setToolsBySession((prev) => ({ ...prev, [sessionId]: [] }));
    }
  }, []);

  useEffect(() => {
    for (const tabId of workspace.tabOrder) {
      const tab = workspace.tabs[tabId];
      if (tab?.sessionId) void fetchTools(tab.sessionId);
    }
  }, [workspace.tabOrder, workspace.tabs, fetchTools]);

  // Right panel — file tabs and the context tab
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [rightPanelState, setRightPanelState] = useState<"closed" | "normal" | "expanded">("closed");

  // Favorites — global list of session IDs, shared between the sidebar indicator
  // and the right-panel CollectionPanel so the two views stay in sync.
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

  // Panel widths are derived from the fixed ratios above.
  const leftWidth = `${LEFT_PANEL_RATIO * 100}%`;
  const rightWidth = `${RIGHT_PANEL_RATIO * 100}%`;

  const getActiveChatInput = useCallback(() => {
    if (!activeTabId) return null;
    return chatInputRefs.current.get(activeTabId)?.current ?? null;
  }, [activeTabId]);

  const handleAtMention = useCallback((filePath: string) => {
    getActiveChatInput()?.insertText("`" + filePath + "`");
  }, [getActiveChatInput]);

  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);

  // The cwd picker belongs to the active tab. Picking a different project
  // while viewing a formal session opens (or reuses) the single draft instead
  // of destroying the formal tab and its live controller.
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

  // First entry (no session in URL, nothing selected): land directly on the
  // new-session page with the most recently used cwd pre-picked, so typing
  // works immediately without a placeholder detour. If there are no projects
  // yet the CwdPicker shows "Select project..." and the user creates one.
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
    void fetchTools(session.id);
    closeTopPanel();
    // URL synchronization is centralized below and uses replace, so opening a
    // background/existing tab never creates a browser-history entry by itself.
  }, [closeTopPanel, fetchTools]);

  // Command palette: convert search result to SessionInfo and open it
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

  // Called when /new slash command is triggered. Pass a `cwdOverride` to
  // pick a non-active cwd (e.g. the per-cwd "+" button in the sidebar)
  // — otherwise we reuse the currently selected session's cwd, falling
  // back to the in-flight new-session cwd.
  const handleSlashNew = useCallback((cwdOverride?: string) => {
    const cwd = cwdOverride ?? selectedSession?.cwd ?? newSessionCwd;
    if (!cwd) return;
    handleNewSession("draft", cwd);
  }, [selectedSession?.cwd, newSessionCwd, handleNewSession]);

  // A draft upgrades in place when POST /api/agent/new returns. The tab id is
  // supplied by WorkspaceChatTab, so no second controller or duplicate tab is
  // created for the newly formal session.
  const handleSessionCreated = useCallback((tabId: string, session: SessionInfo) => {
    dispatchWorkspace({ type: "upgrade_draft", tabId, session });
    void fetchTools(session.id);
  }, [fetchTools]);

  // Called by SchedulerModal "Open session" — routes through the same
  // de-duplicating open path as the sidebar.
  const handleOpenScheduledSession = useCallback((sessionId: string) => {
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { info?: SessionInfo };
        if (data.info) handleSelectSession(data.info);
      } catch {
        router.replace(`?session=${encodeURIComponent(sessionId)}`, { scroll: false });
      }
    })();
  }, [handleSelectSession, router]);

  const handleAgentEnd = useCallback((tabId?: string) => {
    setRefreshKey((k) => k + 1);
    if (!tabId || tabId === workspaceRef.current.activeTabId) {
      setExplorerRefreshKey((k) => k + 1);
    }
  }, []);

  // New sessions become listable only after pi persists the first assistant
  // message (lazy .jsonl creation), so refresh at that moment — not at
  // session creation, when the file does not exist yet.
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
    closeTopPanel();
  }, [closeTopPanel]);

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

  // Per-tab reload counters. Each tab keeps its controller mounted across
  // activation changes so SSE + scroll survive tab switches; bumping a tab's
  // counter folds into WorkspaceChatTab's `key`, which forces React to unmount
  // and remount that controller — clearing all in-memory state and reloading
  // the session from disk via `useAgentSession`'s mount effect.
  const [reloadCounters, setReloadCounters] = useState<Record<string, number>>({});
  const handleReloadSessionTab = useCallback((tabId: string) => {
    const tab = workspaceRef.current.tabs[tabId];
    if (!tab || tab.kind !== "session") return;
    setReloadCounters((prev) => ({ ...prev, [tabId]: (prev[tabId] ?? 0) + 1 }));
    toast.show({ kind: "info", message: t("Refreshed") });
  }, [t, toast]);

  // Only the active tab is written to the URL. `replace` keeps tab switching
  // out of browser back/forward history, while a refresh still restores the
  // one session named by the URL.
  useEffect(() => {
    if (!initialSessionRestored) return;
    const sessionId = activeTab?.sessionId ?? null;
    const current = searchParams.get("session");
    if (current === sessionId) return;
    const target = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "/";
    router.replace(target, { scroll: false });
  }, [activeTab?.sessionId, initialSessionRestored, router, searchParams]);

  const handleOpenFile = useCallback((filePath: string, fileName: string) => {
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      if (prev.find((t) => t.id === tabId)) return prev;
      return [...prev, { kind: "file", id: tabId, label: fileName, filePath }];
    });
    setActiveFileTabId(tabId);
    setRightPanelState("normal");
  }, []);

  // Open the todos tab. If it's already in the tab strip, just activate it;
  // if not, insert it at the leftmost position and activate it. Mirrors
  // handleOpenFile so existing file tabs are never displaced.
  const handleOpenTodoTab = useCallback(() => {
    setFileTabs((prev) => {
      if (prev.some((t) => t.kind === "todo")) return prev;
      return [{ kind: "todo", id: TODO_TAB_ID, label: t("Todos") }, ...prev];
    });
    setActiveFileTabId(TODO_TAB_ID);
    setRightPanelState("normal");
  }, [t]);

  // Open the favorites tab — same pattern as todos / file tabs.
  const handleOpenFavoritesTab = useCallback(() => {
    setFileTabs((prev) => {
      if (prev.some((t) => t.kind === "favorites")) return prev;
      return [{ kind: "favorites", id: FAVORITES_TAB_ID, label: t("Favorites") }, ...prev];
    });
    setActiveFileTabId(FAVORITES_TAB_ID);
    setRightPanelState("normal");
  }, [t]);

  // Open the translate tab — same pattern as todos / favorites.
  const handleOpenTranslateTab = useCallback(() => {
    setFileTabs((prev) => {
      if (prev.some((t) => t.kind === "translate")) return prev;
      return [{ kind: "translate", id: TRANSLATE_TAB_ID, label: t("Translate") }, ...prev];
    });
    setActiveFileTabId(TRANSLATE_TAB_ID);
    setRightPanelState("normal");
  }, [t]);

  // Open the tool-calls tab. Toggles: clicking when it's already the active
  // tab hides the right panel entirely; otherwise activate (or create) the
  // tab. Mirrors the original drawer toggle behaviour.
  const handleOpenToolCallsTab = useCallback(() => {
    const alreadyActive = activeFileTabId === TOOL_CALLS_TAB_ID && rightPanelState !== "closed";
    if (alreadyActive) {
      setActiveFileTabId(null);
      setRightPanelState("closed");
      return;
    }
    setFileTabs((prev) => {
      if (prev.some((tab) => tab.kind === "toolCalls")) return prev;
      return [{ kind: "toolCalls", id: TOOL_CALLS_TAB_ID, label: t("Tool Calls") }, ...prev];
    });
    setActiveFileTabId(TOOL_CALLS_TAB_ID);
    setRightPanelState("normal");
  }, [activeFileTabId, rightPanelState, t]);

  // Open the JSON formatter tab — same pattern as todos / favorites / translate.
  const handleOpenJsonTab = useCallback(() => {
    setFileTabs((prev) => {
      if (prev.some((tab) => tab.kind === "json")) return prev;
      return [{ kind: "json", id: JSON_TAB_ID, label: t("JSON") }, ...prev];
    });
    setActiveFileTabId(JSON_TAB_ID);
    setRightPanelState("normal");
  }, [t]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const active = document.activeElement;
      const isEditable =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      // Ctrl+B — toggle left sidebar (skipped when an editor is focused)
      if (mod && e.key === "b" && !e.altKey) {
        if (!isEditable) {
          e.preventDefault();
          setSidebarOpen((v) => !v);
        }
        return;
      }
      // Ctrl+Alt+B — toggle right sidebar
      if (mod && e.altKey && e.key === "b") {
        e.preventDefault();
        setRightPanelState((v) => v === "closed" ? "normal" : "closed");
        return;
      }
      // Ctrl+K — command palette. Fires regardless of focus (matches the
      // VS Code / Slack / GitHub convention): users expect ⌘K to open the
      // global search bar even while typing in the chat input or a rich-text
      // editor. Ctrl+B keeps its isEditable guard so it doesn't hijack the
      // text-editor "bold" shortcut.
      if (mod && e.key === "k") {
        e.preventDefault();
        if (paletteOpen) {
          setPaletteOpen(false);
        } else {
          openPalette();
        }
        return;
      }
      // Space — focus chat input when not already focused. Skip when focus
      // is inside the canvas panel: Excalidraw uses Space as its pan-tool
      // gesture, and stealing focus would break that.
      if (
        e.key === " " &&
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        !paletteOpen &&
        getActiveChatInput()
      ) {
        if (
          !isEditable &&
          !(active instanceof HTMLElement && active.closest("[data-pi-canvas-panel]"))
        ) {
          e.preventDefault();
          getActiveChatInput()?.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [paletteOpen, openPalette, getActiveChatInput]);

  // Open the canvas tab — single global whiteboard, persisted in localStorage.
  const handleOpenCanvasTab = useCallback(() => {
    setFileTabs((prev) => {
      if (prev.some((tab) => tab.kind === "canvas")) return prev;
      return [{ kind: "canvas", id: CANVAS_TAB_ID, label: t("Canvas") }, ...prev];
    });
    setActiveFileTabId(CANVAS_TAB_ID);
    setRightPanelState("normal");
  }, [t]);

  // Open the RSS panel — same pattern as translate / http / json.
  const handleOpenRssTab = useCallback(() => {
    setFileTabs((prev) => {
      if (prev.some((tab) => tab.kind === "rss")) return prev;
      return [{ kind: "rss", id: RSS_TAB_ID, label: t("RSS") }, ...prev];
    });
    setActiveFileTabId(RSS_TAB_ID);
    setRightPanelState("normal");
  }, [t]);

  // Open the Token-audit panel.
  const handleOpenTokensTab = useCallback(() => {
    setFileTabs((prev) => {
      if (prev.some((tab) => tab.kind === "tokens")) return prev;
      return [{ kind: "tokens", id: TOKENS_TAB_ID, label: t("Token audit") }, ...prev];
    });
    setActiveFileTabId(TOKENS_TAB_ID);
    setRightPanelState("normal");
  }, [t]);

  // Open the LLM API audit panel.
  const handleOpenLlmAuditTab = useCallback(() => {
    setFileTabs((prev) => {
      if (prev.some((tab) => tab.kind === "llmAudit")) return prev;
      return [{ kind: "llmAudit", id: LLM_AUDIT_TAB_ID, label: t("LLM API audit") }, ...prev];
    });
    setActiveFileTabId(LLM_AUDIT_TAB_ID);
    setRightPanelState("normal");
  }, [t]);

  // Open the Context panel — combines the session system prompt and tool list.
  const handleOpenContextTab = useCallback(() => {
    const alreadyActive = activeFileTabId === CONTEXT_TAB_ID && rightPanelState !== "closed";
    if (alreadyActive) {
      setActiveFileTabId(null);
      setRightPanelState("closed");
      return;
    }
    setFileTabs((prev) => {
      if (prev.some((tab) => tab.kind === "context")) return prev;
      return [{ kind: "context", id: CONTEXT_TAB_ID, label: t("Context") }, ...prev];
    });
    setActiveFileTabId(CONTEXT_TAB_ID);
    setRightPanelState("normal");
  }, [activeFileTabId, rightPanelState, t]);

  // Open the git diff panel — same pattern as translate / rss / tokens.
  const handleOpenGitDiffTab = useCallback(() => {
    setFileTabs((prev) => {
      if (prev.some((tab) => tab.kind === "gitDiff")) return prev;
      return [{ kind: "gitDiff", id: GIT_DIFF_TAB_ID, label: t("Git Diff") }, ...prev];
    });
    setActiveFileTabId(GIT_DIFF_TAB_ID);
    setRightPanelState("normal");
  }, [t]);

  // Open the conversation-tree panel — card map of the session's tree.
  const handleOpenConversationTreeTab = useCallback(() => {
    setFileTabs((prev) => {
      if (prev.some((tab) => tab.kind === "conversationTree")) return prev;
      return [{ kind: "conversationTree", id: CONVERSATION_TREE_TAB_ID, label: t("Conversation Tree") }, ...prev];
    });
    setActiveFileTabId(CONVERSATION_TREE_TAB_ID);
    setRightPanelState("normal");
  }, [t]);

  // Click on a card in the conversation-tree panel. We always resolve the
  // clicked card to the deepest leaf entry in its subtree, so the chat
  // jumps to the *end* of that branch rather than stopping at an ancestor
  // card. While the agent is busy with this turn (which includes tool
  // calls between LLM turns, not just streaming) we drop the click entirely
  // — the card is also visually disabled at the source, but we double-check
  // here so any non-mouse trigger (keyboard, programmatic) is also blocked.
  const handleConversationTreeCardClick = useCallback((cardId: string) => {
    if (agentRunning) return;
    const targetLeafId = findDeepestLeafEntryId(cardId, branchTree) ?? cardId;
    if (branchActiveLeafId !== targetLeafId) {
      handleBranchLeafChange(targetLeafId);
    }
  }, [agentRunning, branchActiveLeafId, branchTree, handleBranchLeafChange]);

  // Right-bar tab buttons toggle the panel only when their own tab is both
  // active and visible. Opening through other entry points keeps its existing
  // "open this tab" semantics.
  const handleToggleRightPanelTab = useCallback((tabId: string, openTab: () => void) => {
    if (activeFileTabId === tabId && rightPanelState !== "closed") {
      setRightPanelState("closed");
      return;
    }
    openTab();
  }, [activeFileTabId, rightPanelState]);

  const handleCloseFileTab = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) setRightPanelState("closed");
      return next;
    });
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, [fileTabs]);

  // Close every tab strictly to the left of `tabId` (the right-clicked one).
  // If the active tab is being closed, fall back to `tabId` (still open).
  const handleCloseLeftTabs = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx <= 0) return prev;
      return prev.slice(idx);
    });
    setActiveFileTabId((cur) => {
      if (cur === null) return cur;
      const activeIdx = fileTabs.findIndex((t) => t.id === cur);
      const refIdx = fileTabs.findIndex((t) => t.id === tabId);
      if (activeIdx >= 0 && activeIdx < refIdx) return tabId;
      return cur;
    });
  }, [fileTabs]);

  // Close every tab strictly to the right of `tabId`. If the active tab is
  // being closed, fall back to `tabId`.
  const handleCloseRightTabs = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx === -1 || idx === prev.length - 1) return prev;
      return prev.slice(0, idx + 1);
    });
    setActiveFileTabId((cur) => {
      if (cur === null) return cur;
      const activeIdx = fileTabs.findIndex((t) => t.id === cur);
      const refIdx = fileTabs.findIndex((t) => t.id === tabId);
      if (activeIdx > refIdx && refIdx >= 0) return tabId;
      return cur;
    });
  }, [fileTabs]);

  // Close every tab other than `tabId`. The right-clicked tab is preserved
  // (and becomes the active one if it wasn't already), so the panel never
  // collapses from this action.
  const handleCloseOtherTabs = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      if (!prev.some((t) => t.id === tabId)) return prev;
      return prev.filter((t) => t.id === tabId);
    });
    setActiveFileTabId(tabId);
  }, []);

  // Build the per-tab right-click menu. Single tab → no batch actions shown.
  const handleTabContextMenu = useCallback((tabId: string, x: number, y: number) => {
    const idx = fileTabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const hasLeft = idx > 0;
    const hasRight = idx < fileTabs.length - 1;
    const hasOthers = fileTabs.length > 1;
    const items: ContextMenuItem[] = [
      { key: "close", label: t("Close tab"), onSelect: () => handleCloseFileTab(tabId) },
      { key: "close-left", label: t("Close tabs to the left"), onSelect: () => handleCloseLeftTabs(tabId), disabled: !hasLeft },
      { key: "close-right", label: t("Close tabs to the right"), onSelect: () => handleCloseRightTabs(tabId), disabled: !hasRight },
      { key: "close-others", label: t("Close other tabs"), onSelect: () => handleCloseOtherTabs(tabId), disabled: !hasOthers },
    ];
    cm.open({ x, y, items });
  }, [fileTabs, t, cm, handleCloseFileTab, handleCloseLeftTabs, handleCloseRightTabs, handleCloseOtherTabs]);

  const handleFileDeleted = useCallback((filePath: string) => {
    handleCloseFileTab(`file:${filePath}`);
  }, [handleCloseFileTab]);

  // Show chat after the initial URL restore is done (or immediately when no
  // session parameter was supplied). A draft tab exists even before a cwd is
  // selected, so the welcome/input view can render without a placeholder.
  const showChat = initialSessionRestored && workspace.tabOrder.length > 0;

  const [rightPanelRect, setRightPanelRect] = useState<{ left: number; width: number } | null>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) ?? null;
  const activeRightPanelKind = rightPanelState === "closed" ? null : activeFileTab?.kind ?? null;

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalLocation, setTerminalLocation] = useState<"bottom" | "right">(() => {
    if (typeof window === "undefined") return "bottom";
    try {
      return localStorage.getItem(TERMINAL_LOCATION_KEY) === "right" ? "right" : "bottom";
    } catch {
      return "bottom";
    }
  });
  const [terminalMaximized, setTerminalMaximized] = useState(false);

  // The right-panel rect is only consumed by the right-docked terminal
  // overlay. When the terminal is at the bottom, skip the observer entirely —
  // the resize callback would otherwise fire a full AppShell re-render on
  // every animation frame while the panel width animates (the main reason
  // collapse/expand used to feel janky). When it is needed, rAF-coalesce the
  // callback and skip no-op updates.
  useEffect(() => {
    if (terminalLocation !== "right") return;
    const panel = rightPanelRef.current;
    if (!panel) return;
    let raf = 0;
    const update = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rect = panel.getBoundingClientRect();
        setRightPanelRect((prev) =>
          prev && Math.abs(prev.left - rect.left) < 0.5 && Math.abs(prev.width - rect.width) < 0.5
            ? prev
            : { left: rect.left, width: rect.width }
        );
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    window.addEventListener("resize", update);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [terminalLocation]);
  const [terminalHeight, setTerminalHeight] = useState<number>(() => {
    if (typeof window === "undefined") return 200;
    try {
      const v = Number(localStorage.getItem(TERMINAL_HEIGHT_KEY));
      if (Number.isFinite(v) && v >= MIN_TERMINAL_HEIGHT && v <= window.innerHeight - 60) return v;
    } catch {
      // ignore
    }
    return 200;
  });

  useEffect(() => {
    try {
      localStorage.setItem(TERMINAL_HEIGHT_KEY, String(terminalHeight));
    } catch {
      // ignore
    }
  }, [terminalHeight]);

  // Closing the panel also leaves maximized mode, so the next open restores
  // the normal drag-sized height.
  useEffect(() => {
    if (!terminalOpen) setTerminalMaximized(false);
  }, [terminalOpen]);

  const openTerminalOnRight = useCallback(() => {
    setFileTabs((prev) => {
      if (prev.some((tab) => tab.kind === "terminal")) return prev;
      return [...prev, { kind: "terminal", id: TERMINAL_TAB_ID, label: t("Terminal") }];
    });
    setActiveFileTabId(TERMINAL_TAB_ID);
    setRightPanelState("normal");
    setTerminalOpen(true);
  }, [t]);

  const toggleTerminal = useCallback(() => {
    if (terminalLocation === "right") {
      if (terminalOpen && activeFileTabId === TERMINAL_TAB_ID && rightPanelState !== "closed") {
        setTerminalOpen(false);
        handleCloseFileTab(TERMINAL_TAB_ID);
      } else {
        openTerminalOnRight();
      }
      return;
    }
    setTerminalOpen((v) => !v);
  }, [terminalLocation, terminalOpen, activeFileTabId, rightPanelState, handleCloseFileTab, openTerminalOnRight]);

  // ── Right-bar button column context ──
  // Built late because it depends on toggleTerminal, which is declared
  // just above. The descriptor list itself is stable so the column only
  // re-renders on actual state change, not on every callback-identity
  // mutation. ctx is rebuilt every render anyway — RightBarColumn memoizes
  // what matters (cfg.order → ordered ids).
  const selectedSessionId = selectedSession?.id ?? null;
  const selectedCwd = selectedSession?.cwd ?? newSessionCwd ?? null;
  const { snapshot: toolStatsSnapshot } = useToolCallStatsView();
  // Number of changed files for the active cwd's git repo — drives the
  // badge on the git-diff right-bar button. The store is event-driven
  // now (refreshes on edit/write tool ends), so this stays live without
  // polling. Falls back to 0 when there's no cwd, the cwd isn't a repo,
  // or the repo has no changes — in all three cases the badge hides.
  const gitStore = useGitStatusStore();
  const gitChangedCount = selectedCwd
    ? (gitStore.entriesByCwd.get(selectedCwd)?.files.length ?? 0)
    : 0;
  const rightBarCtx: RightBarCtx = {
    rightPanelState,
    activeTabKind: activeRightPanelKind,
    hasOpenTabs: fileTabs.length > 0,
    selectedSessionId,
    selectedCwd,
    terminalOpen,
    rssUnread,
    gitChangedCount,
    toolStats: {
      runningCount: toolStatsSnapshot.runningCount,
      totalCount: toolStatsSnapshot.totalCount,
    },
    t,
    toggleRightPanel: () =>
      setRightPanelState((v) => (v === "closed" ? "normal" : "closed")),
    toggleRightPanelTab: handleToggleRightPanelTab,
    setRightPanelState,
    toggleTerminal,
    openTab: {
      todo: handleOpenTodoTab,
      canvas: handleOpenCanvasTab,
      translate: handleOpenTranslateTab,
      json: handleOpenJsonTab,
      rss: handleOpenRssTab,
      gitDiff: handleOpenGitDiffTab,
      favorites: handleOpenFavoritesTab,
      tokens: handleOpenTokensTab,
      toolCalls: handleOpenToolCallsTab,
      conversationTree: handleOpenConversationTreeTab,
      llmAudit: handleOpenLlmAuditTab,
      context: handleOpenContextTab,
    },
  };

  const moveTerminal = useCallback(() => {
    if (terminalLocation === "bottom") {
      setTerminalLocation("right");
      setTerminalMaximized(false);
      openTerminalOnRight();
    } else {
      setTerminalLocation("bottom");
      handleCloseFileTab(TERMINAL_TAB_ID);
      setTerminalOpen(true);
    }
  }, [terminalLocation, handleCloseFileTab, openTerminalOnRight]);

  useEffect(() => {
    try {
      localStorage.setItem(TERMINAL_LOCATION_KEY, terminalLocation);
    } catch {
      // ignore
    }
  }, [terminalLocation]);

  useEffect(() => {
    if (terminalLocation === "right" && !fileTabs.some((tab) => tab.kind === "terminal")) {
      setTerminalOpen(false);
    }
  }, [terminalLocation, fileTabs]);

  const toggleTerminalMaximize = useCallback(() => setTerminalMaximized((v) => !v), []);

  // Ctrl+` toggles the terminal panel (VS Code muscle memory).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key === "`") {
        e.preventDefault();
        if (terminalLocation === "right") {
          openTerminalOnRight();
        } else {
          setTerminalOpen((v) => !v);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [terminalLocation, openTerminalOnRight]);

  // Drag the bottom panel's top edge to resize (clamped to min/max).
  const startTerminalDrag = useCallback(
    (startY: number) => {
      const startH = terminalHeight;
      const onMove = (ev: MouseEvent) => {
        const next = startH - (ev.clientY - startY);
        setTerminalHeight(Math.min(Math.max(next, MIN_TERMINAL_HEIGHT), window.innerHeight - 60));
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

  // New terminals default to the active session's cwd; without a session,
  // fall back to the last-used directory.
  const terminalDefaultCwd = useMemo(() => {
    const sessionCwd = selectedSession?.cwd ?? newSessionCwd;
    if (sessionCwd) return sessionCwd;
    try {
      return localStorage.getItem("pi-terminal-cwd") || "~";
    } catch {
      return "~";
    }
  }, [selectedSession, newSessionCwd]);

  // When the user hides a button whose panel is currently active, the right
  // panel would otherwise sit open with no toggle in the bar. Auto-close the
  // panel — the tab itself stays in the tab strip so re-enabling the button
  // and clicking it again reopens the same view. "file" and "terminal"
  // kinds have no configurable button behind them so the lookup returns
  // undefined and the panel stays open.
  useEffect(() => {
    if (rightPanelState === "closed") return;
    if (activeRightPanelKind === null) return;
    const id = RIGHT_BAR_ID_FOR_TAB_KIND[activeRightPanelKind];
    if (id === undefined) return; // "file" / "terminal" kind — no configurable button
    if (isRightBarButtonVisible(rightSideBarConfig, id)) return;
    setRightPanelState("closed");
  }, [rightPanelState, activeRightPanelKind, rightSideBarConfig]);

  // ── Command palette context + command list ──
  // Re-built whenever any input changes (cheap; buildCommands is O(N) where
  // N is the number of declared commands). AppShell is the only place that
  // knows about every handler the palette may call.
  const commandContext = useMemo<CommandContext>(() => ({
    setTheme: theme.setPreset,
    setLocale,
    newSession: handleSlashNew,
    openSettings: () => setSettingsConfigOpen(true),
    openModels: () => setModelsConfigOpen(true),
    openSkills: () => setSkillsConfigOpen(true),
    openPrompts: () => setPromptsConfigOpen(true),
    openScheduler: () => setSchedulerOpen(true),
    openTodosTab: handleOpenTodoTab,
    openFavoritesTab: handleOpenFavoritesTab,
    openCanvasTab: handleOpenCanvasTab,
    openTranslateTab: handleOpenTranslateTab,
    openToolCallsTab: handleOpenToolCallsTab,
    openJsonTab: handleOpenJsonTab,
    openTokensTab: handleOpenTokensTab,
    openGitDiffTab: handleOpenGitDiffTab,
    openLlmAuditTab: handleOpenLlmAuditTab,
    toggleSidebar: () => setSidebarOpen((v) => !v),
    toggleRightPanel: () => setRightPanelState((v) => v === "closed" ? "normal" : "closed"),
    agentControls,
    hasSession: selectedSession !== null || newSessionCwd !== null,
    hasCwd: !!(selectedSession?.cwd ?? newSessionCwd),
  }), [
    theme.setPreset, setLocale, handleSlashNew,
    handleOpenTodoTab, handleOpenFavoritesTab, handleOpenCanvasTab,
    handleOpenTranslateTab, handleOpenToolCallsTab, handleOpenJsonTab,
    handleOpenTokensTab, handleOpenGitDiffTab, handleOpenLlmAuditTab,
    agentControls,
    selectedSession, newSessionCwd,
  ]);

  const commands = useMemo<Command[]>(
    () => buildCommands(commandContext, t),
    [commandContext, t],
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
      onOpenModels={() => setModelsConfigOpen(true)}
      onOpenSkills={() => setSkillsConfigOpen(true)}
      onOpenPrompts={() => setPromptsConfigOpen(true)}
      onOpenScheduler={() => setSchedulerOpen(true)}
      onOpenSettings={() => setSettingsConfigOpen(true)}
      onOpenInbox={() => setInboxOpen(true)}
      inboxUnread={inboxUnread}
      profileRefreshKey={profileRefreshKey}
    />
  );

  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden", background: "var(--bg)" }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {/* Mobile overlay backdrop */}
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

      {/* Left sidebar */}
      <div
        className={`sidebar-container${sidebarOpen ? "" : " sidebar-closed"}`}
        style={{
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
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

      {/* Drag handle removed — sidebar width is fixed. */}

      {/* Center: chat — flex-grow animates the squeeze when the right panel
          goes expanded: center grows 1->0 while the right panel grows 0->1,
          so the whiteboard takeover slides instead of snapping. */}
      <div style={{ flex: rightPanelState === "expanded" ? "0 1 0%" : "1 1 0%", display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, transition: "flex-grow 0.18s cubic-bezier(0.32, 0.72, 0, 1)" }}>
        {showChat && (
          <SessionTabBar
            leadingControl={
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
            }
            tabs={workspace.tabOrder.map((tabId) => workspace.tabs[tabId]).filter((tab): tab is SessionTab => Boolean(tab))}
            activeTabId={activeTabId}
            onSelectTab={handleActivateSessionTab}
            onCloseTab={(tabId) => { void handleCloseSessionTab(tabId); }}
            onBatchClose={(tabId, mode) => { void handleBatchCloseSessionTabs(tabId, mode); }}
            onReload={handleReloadSessionTab}
            onNewSession={() => handleSlashNew()}
          />
        )}

        {/* Chat content. Every opened tab keeps its controller mounted so its
            messages, input draft, scroll position and SSE survive activation
            changes. Only the active controller is visible/projected. */}
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

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      <div
        ref={rightPanelRef}
        className={`right-panel-container right-panel-${rightPanelState}`}
        style={{
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg)",
          width: rightPanelState === "closed" ? 0 : rightWidth,
          minWidth: rightPanelState === "closed" ? 0 : rightWidth,
        }}
      >
        {/* Right panel tab bar */}
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36 }}>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TabBar
              tabs={fileTabs}
              activeTabId={activeFileTabId ?? ""}
              onSelectTab={(tabId) => {
                setActiveFileTabId(tabId);
                if (tabId === TERMINAL_TAB_ID) setRightPanelState("normal");
              }}
              onCloseTab={(tabId) => {
                if (tabId === TERMINAL_TAB_ID) setTerminalOpen(false);
                handleCloseFileTab(tabId);
              }}
              onContextMenu={handleTabContextMenu}
            />
          </div>
        </div>

        {/* File content */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {activeFileTab?.kind === "todo" ? (
            <MemoTodoPanel />
          ) : activeFileTab?.kind === "favorites" ? (
            <CollectionPanel
              favoriteIds={favoriteIds}
              onSelectSession={handleSelectSession}
              onToggleFavorite={toggleSessionFavorite}
            />
          ) : activeFileTab?.kind === "translate" ? (
            <TranslatePanel />
          ) : activeFileTab?.kind === "toolCalls" ? (
            <ToolCallStatsTabBody />
          ) : activeFileTab?.kind === "json" ? (
            <JsonPanel />
          ) : activeFileTab?.kind === "file" ? (
            <FileViewer filePath={activeFileTab.filePath} cwd={selectedSession?.cwd ?? newSessionCwd ?? undefined} />
          ) : activeFileTab?.kind === "canvas" ? (
            <CanvasPanel />
          ) : activeFileTab?.kind === "rss" ? (
            <RssPanel />
          ) : activeFileTab?.kind === "tokens" ? (
            <TokensPanel />
          ) : activeFileTab?.kind === "llmAudit" ? (
            <LlmAuditPanel currentSessionId={selectedSession?.id ?? null} />
          ) : activeFileTab?.kind === "context" ? (
            <ContextPanel
              systemPrompt={systemPrompt}
              tools={tools}
            />
          ) : activeFileTab?.kind === "gitDiff" ? (
            <GitDiffPanel cwd={selectedSession?.cwd ?? newSessionCwd ?? null} />
          ) : activeFileTab?.kind === "conversationTree" ? (
            <ConversationTreePanel
              isStreaming={isStreaming}
              agentRunning={agentRunning}
              onCardClick={(card) => handleConversationTreeCardClick(card.id)}
            />
          ) : activeFileTab?.kind === "terminal" ? null : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
              {t("No file open")}
            </div>
          )}
        </div>
      </div>

      {/* Right button bar — every toggle is driven by the
          components/rightBar descriptor registry now. Adding a new button
          is a one-line append to RIGHT_BAR_DESCRIPTORS. */}
      <RightBarColumn cfg={rightSideBarConfig} ctx={rightBarCtx} />
    </div>

    {/* Bottom terminal panel — floats OVER the page (fixed overlay) instead of
        squeezing the layout above. Always mounted so terminals survive
        collapse; the wrapper animates its height. */}
    <div
      style={{
        position: "fixed",
        left: terminalLocation === "right" ? rightPanelRect?.left : 0,
        right: terminalLocation === "right" ? undefined : 36,
        top: terminalLocation === "right" ? 36 : undefined,
        bottom: 0,
        width: terminalLocation === "right" ? rightPanelRect?.width : undefined,
        display: "flex",
        flexDirection: "column",
        height: terminalLocation === "right"
          ? (terminalOpen && activeFileTabId === TERMINAL_TAB_ID && rightPanelState !== "closed" ? "calc(100dvh - 36px)" : 0)
          : (terminalOpen ? (terminalMaximized ? "100dvh" : terminalHeight) : 0),
        minHeight: 0,
        overflow: "hidden",
        borderTop: terminalLocation === "bottom" && terminalOpen && !terminalMaximized ? "1px solid var(--border)" : "none",
        paddingBottom: terminalLocation === "bottom" && terminalOpen && !terminalMaximized ? 8 : 0,
        borderLeft: terminalLocation === "right" ? "1px solid var(--border)" : "none",
        background: "var(--bg)",
        zIndex: 201,
      }}
    >
      {terminalLocation === "bottom" && terminalOpen && !terminalMaximized && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            startTerminalDrag(e.clientY);
          }}
          onDoubleClick={toggleTerminalMaximize}
          title={t("Drag to resize")}
          style={{ flexShrink: 0, height: 5, cursor: "ns-resize", background: "var(--bg-panel)" }}
        />
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TerminalPanel
          defaultCwd={terminalDefaultCwd}
          open={terminalOpen}
          location={terminalLocation}
          onMove={moveTerminal}
          maximized={terminalMaximized}
          onToggleMaximize={toggleTerminalMaximize}
          onClosePanel={() => {
            setTerminalOpen(false);
            if (terminalLocation === "right") handleCloseFileTab(TERMINAL_TAB_ID);
          }}
        />
      </div>
    </div>
  </div>
  {modelsConfigOpen && <ModelsConfig onClose={() => { setModelsConfigOpen(false); setModelsRefreshKey((k) => k + 1); }} />}
    {skillsConfigOpen && (selectedSession?.cwd ?? newSessionCwd) && (
      <SkillsConfig cwd={(selectedSession?.cwd ?? newSessionCwd)!} onClose={() => setSkillsConfigOpen(false)} />
    )}
    {promptsConfigOpen && (selectedSession?.cwd ?? newSessionCwd) && (
      <PromptsConfig cwd={(selectedSession?.cwd ?? newSessionCwd)!} onClose={() => setPromptsConfigOpen(false)} />
    )}
    {settingsConfigOpen && <SettingsModal onClose={() => setSettingsConfigOpen(false)} onProfileSaved={() => setProfileRefreshKey((k) => k + 1)} />}
    {schedulerOpen && (
      <SchedulerModal
        open={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        onOpenSession={handleOpenScheduledSession}
      />
    )}
    {inboxOpen && (
      <InboxModal
        open={inboxOpen}
        onClose={() => setInboxOpen(false)}
      />
    )}
    <CommandPalette
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      cwd={selectedSession?.cwd ?? newSessionCwd ?? null}
      onSelectSession={handleSelectSearchResult}
      commands={commands}
      t={t}
    />
    </>
  );
}

function ContextPanel({ systemPrompt, tools }: { systemPrompt: string | null; tools: ToolInfo[] }) {
  const { t } = useI18n();
  const segments = useMemo(() => splitSystemPrompt(systemPrompt ?? ""), [systemPrompt]);
  const pathColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const seg of segments) {
      if (seg.kind === "agents" && !map.has(seg.path)) {
        map.set(seg.path, AGENTS_SEGMENT_COLORS[map.size % AGENTS_SEGMENT_COLORS.length]);
      }
    }
    return map;
  }, [segments]);
  const agentsSegments = useMemo(
    () => segments.filter((seg): seg is Extract<SystemPromptSegment, { kind: "agents" }> => seg.kind === "agents"),
    [segments],
  );
  const sortedTools = useMemo(() => [...tools].sort((a, b) => a.name.localeCompare(b.name)), [tools]);

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
      <section style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
          {t("System Prompts")}
        </div>
        {systemPrompt ? (
          <div>
            {agentsSegments.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 10, fontSize: 11, color: "var(--text-muted)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--text-dim)", flexShrink: 0 }} />
                  <span>{t("Pi base + Append")}</span>
                </div>
                {agentsSegments.map((seg) => {
                  const color = pathColor.get(seg.path)!;
                  return (
                    <div key={seg.path} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
                      <span style={{ fontFamily: "var(--font-mono)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={seg.path}>
                        {seg.path}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
              {segments.map((seg, idx) => {
                if (seg.kind === "base") {
                  return <span key={`base-${idx}`}>{seg.text}</span>;
                }
                const color = pathColor.get(seg.path)!;
                return (
                  <span key={`agents-${idx}-${seg.path}`} style={{ display: "block", borderLeft: `3px solid ${color}`, background: `${color}14`, marginTop: 8, marginBottom: 8, paddingLeft: 10, paddingTop: 4, paddingBottom: 4 }}>
                    <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={seg.path}>
                      {seg.path}
                    </div>
                    {seg.text}
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ fontStyle: "italic" }}>{t("System prompt is empty (tools are disabled)")}</div>
        )}
      </section>
      <section style={{ padding: "12px 16px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
          {t("Tools")}
        </div>
        {sortedTools.length === 0 ? (
          <div style={{ fontStyle: "italic" }}>{t("Loading tools...")}</div>
        ) : (
          <div>
            {sortedTools.map((tool) => (
              <div key={tool.name} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid color-mix(in srgb, var(--border) 55%, transparent)" }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--text-dim)", flexShrink: 0, marginTop: 4 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500, fontFamily: "var(--font-mono)" }}>{tool.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5 }}>
                    {tool.description || t("No description")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Tool-calls vertical button ────────────────────────────────────────────
// Mirrors the style of the other right-bar buttons (todos / favorites /
// translate) and overlays a tiny live badge for the running / total count.
// Tool-calls button rendering now lives in the rightBar descriptor
// registry (see components/rightBar/desc.tsx) — `ToolCallsVerticalButton`
// was a one-off wrapper duplicated against every other button; the
// unified `RightBarButton` covers it through `bodyLayout: column + gap:1`.

// ── Tool-calls tab body ───────────────────────────────────────────────────
// Wires the published snapshot + scroll callback into the panel component.

function ToolCallStatsTabBody() {
  const { snapshot } = useToolCallStatsView();
  const scrollToToolCall = useToolCallStatsScroll();
  return <ToolCallStatsPanel snapshot={snapshot} onScrollToToolCall={scrollToToolCall} />;
}
