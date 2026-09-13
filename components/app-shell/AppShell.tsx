"use client";

import { useState, useCallback, useMemo, useRef, useEffect, useReducer, memo, type RefObject, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSessionUiState, useSessionLeafChange, useSystemPromptRefresh } from "@/hooks/sessionUiStore";
import { initCwdList, useCwdList } from "@/hooks/cwdListStore";
import { SessionSidebar } from "../sessions/SessionSidebar";
import { SidebarFlipContainer } from "../sessions/SidebarFlipContainer";
import { SidebarBackPanel } from "../sessions/SidebarBackPanel";
import { ChatWindow } from "../chat/ChatWindow";
import { TextSelectionToolbar } from "../chat/text-selection-toolbar";
import { TranslateBubble } from "../chat/translate-bubble";
import { useTextSelection } from "@/hooks/useTextSelection";
import { SessionTabBar } from "../sessions/SessionTabBar";
import { FileViewer } from "../files/FileViewer";
import { TabBar } from "../ui/TabBar";
import { CollectionPanel } from "../sessions/CollectionPanel";
import { TranslatePanel } from "../panels/TranslatePanel";
import { ToolCallStatsPanel } from "../panels/ToolCallStatsPanel";
import { RssPanel } from "../rss/RssPanel";
import { GitHubTrendingPanel } from "../panels/github-trending/GitHubTrendingPanel";
import { KanbanPanel } from "../kanban/KanbanPanel";
import { NotesPanel } from "../panels/notes/NotesPanel";
import { TerminalPanel } from "../panels/TerminalPanel";
import { TokensPanel } from "../panels/TokensPanel";
import { LlmAuditPanel } from "../panels/LlmAuditPanel";
import { GitPanel } from "../panels/GitPanel";
import { BtwPanel } from "../panels/BtwPanel";
import { useToolCallStatsView, useToolCallStatsScroll } from "@/hooks/toolCallStatsStore";
import { ModelsConfig } from "../settings/ModelsConfig";
import { SkillsConfig } from "../settings/SkillsConfig";
import { Tooltip } from "../ui/Tooltip";
import { PromptsConfig } from "../settings/PromptsConfig";
import { SettingsModal } from "../settings/SettingsModal";

import { SchedulerModal } from "../scheduler";
import { ChannelsModal } from "../channels/ChannelsModal";
import { ToolsMarketModal } from "../tools-market/ToolsMarketModal";
import { ConversationTreePanel } from "../sessions/ConversationTreePanel";
import type { SessionTreeNode } from "@/lib/shared/types";
import { CommandPalette } from "./CommandPalette";
import { InboxModal } from "../inbox/InboxModal";
import { CwdPicker } from "../sessions/CwdPicker";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useDisableDefaultTab } from "@/hooks/useDisableDefaultTab";
import { useInboxUnreadCount } from "@/hooks/useInboxUnreadCount";
import { useRssUnreadCount } from "@/hooks/useRssUnreadCount";
import { MorphToggleIcon } from "../ui/MorphToggleIcon";
import { ICONS } from "../ui/icons";
import { MENU, PANEL_LEFT } from "@/lib/client/icon-paths";
import { ExpandLeftIcon } from "../panels/right-bar/icons";
import { ExpandRightIcon } from "../ui/animated-icons";
import { useToast } from "../ui/Toast";
import { useContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import type { SessionInfo, SessionSearchResult } from "@/lib/shared/types";
import { getRelativeFilePath } from "@/lib/shared/file-paths";
import {
  GIT_DIFF_TAB_ID,
  RIGHT_BAR_ID_FOR_TAB_KIND,
} from "@/lib/shared/types";
import { isRightBarButtonVisible } from "@/lib/shared/right-bar";
import {
  createPanelTabsState,
  panelTabsReducer,
  selectActiveKind,
  selectCanExpand,
  selectHasTabs,
  toLegacyTabs,
  type PanelMode,
  type PanelTabsState,
} from "@/lib/shared/panelTabs";
import { useEnsureSettings } from "@/hooks/settingsStore";
import type { ChatInputHandle } from "../chat/ChatInput";
import { sendAgentCommand } from "@/lib/client/agent-client";
import { buildCommands, type Command, type CommandContext } from "@/lib/client/commands";
import { useAgentControls } from "@/hooks/sessionUiStore";
import { RightBarColumn } from "../panels/right-bar/RightBarColumn";
import type { RightBarCtx } from "../panels/right-bar/desc";
import { useGitStatusStore } from "@/lib/client/git-status-store";
import { useRunningSessions } from "@/hooks/runningSessionsStore";
import { useConfirm } from "../ui/ConfirmDialog";
import { usePendingPermissions } from "@/hooks/usePendingPermissions";
import { useLayoutMode, getLayoutModeSync } from "@/hooks/layoutModeStore";
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

// Fixed panel ratios (drag-resize removed). Center column takes the remainder.
const LEFT_PANEL_RATIO = 0.18;
const RIGHT_PANEL_RATIO = 0.32;

// Bottom terminal panel geometry. The chat card keeps a minimum height so
// dragging the terminal taller can never squeeze the chat (input box + a
// couple of messages) out of view.
const TERMINAL_HEIGHT_KEY = "pi-terminal-panel-height";
const MIN_TERMINAL_HEIGHT = 80;
const MIN_CHAT_HEIGHT = 240;

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

// ── Context panel: fine-grained quick-jump anchors inside the base prompt ──
// The pi base prompt is a flat text blob; we cut it at its known section
// headings so the context panel can offer per-section jump targets (Available
// tools / Guidelines / Pi documentation / user's Append) instead of only the
// whole base block. Parsing is defensive: headings that aren't found simply
// yield no anchor, and a custom-prompt setup that matches nothing falls back
// to the whole-block base anchor.

type BasePromptBlock = {
  /** data-context-anchor id; null for unanchored filler. */
  anchor: string | null;
  text: string;
};

const BASE_HEADING_ANCHORS: Array<{ id: string; re: RegExp }> = [
  { id: "available-tools", re: /Available tools:/ },
  { id: "guidelines", re: /Guidelines:/ },
  { id: "pi-docs", re: /Pi documentation/ },
];

/** Detect the `<available_skills>…</available_skills>` listing that pi injects
 *  into its base prompt, so the context panel can offer a dedicated jump
 *  target and highlight each skill's `<name>` line. */
const SKILLS_SECTION_RE = /<available_skills>[\s\S]*?<\/available_skills>/;

/** Index just after pi's \"Always read pi .md files…\" line (the end of the
 *  Pi documentation section). `-1` when the pi docs section is absent. */
function findPiDocsEnd(text: string): number {
  const m = /Always read pi\s*\.md files[^\n]*/.exec(text);
  return m ? m.index + m[0].length : -1;
}

/** Non-whitespace (non-cwd) content still following the pi docs section —
 *  i.e. the user's APPEND_SYSTEM.md block. */
function hasAppendSection(text: string, after: number): boolean {
  const rest = text.slice(after).replace(/\nCurrent working directory:[\s\S]*$/, "");
  return rest.trim().length > 0;
}

/** Slice a base segment into anchorable blocks at its known headings. */
function splitBaseBlocks(text: string): BasePromptBlock[] {
  const marks: Array<{ index: number; id: string }> = [];
  for (const { id, re } of BASE_HEADING_ANCHORS) {
    const m = re.exec(text);
    if (m) marks.push({ index: m.index, id });
  }
  const piDocsEnd = findPiDocsEnd(text);
  if (piDocsEnd >= 0 && hasAppendSection(text, piDocsEnd)) {
    marks.push({ index: piDocsEnd, id: "append" });
  }
  const skillsMatch = SKILLS_SECTION_RE.exec(text);
  if (skillsMatch) marks.push({ index: skillsMatch.index, id: "skills" });
  marks.sort((a, b) => a.index - b.index);
  const blocks: BasePromptBlock[] = [];
  let cursor = 0;
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    if (mark.index > cursor) blocks.push({ anchor: null, text: text.slice(cursor, mark.index) });
    blocks.push({ anchor: mark.id, text: text.slice(mark.index, end) });
    cursor = end;
  }
  if (cursor < text.length) blocks.push({ anchor: null, text: text.slice(cursor) });
  return blocks;
}

/** Combined highlighter for the base prompt body: the skill `<name>…</name>`
 *  tags plus pi's section headings "Available tools:", "Guidelines:" and
 *  "Pi documentation". Matched runs get an accent text colour; everything
 *  else is returned verbatim as raw strings so pre-wrap whitespace is kept. */
const BASE_PROMPT_HIGHLIGHT_RE =
  /<name>[\s\S]*?<\/name>|Available tools:|Guidelines:|Pi documentation/g;

function highlightBasePrompt(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  BASE_PROMPT_HIGHLIGHT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BASE_PROMPT_HIGHLIGHT_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <span key={`${keyPrefix}-${i++}`} style={{ color: "var(--accent)" }}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
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
  /** `/btw` slash action handler (open BTW panel + focus its input). */
  onOpenBtw: () => void;
  /** Open an existing session in a workspace tab. */
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
  onOpenBtw,
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
        onOpenBtw={onOpenBtw}
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

const USEFUL_TIP_KEYS = [
  "You can set a custom Prompt and invoke it with '/'.",
  "For unrelated tasks, consider starting a new session.",
  "Use '/' to run commands and custom Prompts or SKILLs.",
  "Press Space anywhere to focus the conversation input.",
  "Press Ctrl + K to open the command palette.",
  "Switch to a higher thinking level for more complex tasks.",
  "Turn common workflows into SKILLs to reduce repetitive work.",
  "Keep optimizing your AGENTS.md for simplicity and efficiency.",
  "Remove unnecessary plugins, MCPs, and SKILLs to keep context concise and efficient.",
  "Align on requirements before implementing code.",
  "You can switch the current conversation branch in the conversation tree on the right.",
  "Use Git to manage your projects.",
  "Press ↑/↓ in the input box to cycle through sent messages.",
  "Use /btw to ask a question without affecting the current context.",
] as const;

function shuffleTips<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
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
  // Strip the browser default Tab focus-traversal app-wide so that Tab can
  // be repurposed per-surface (see useDisableDefaultTab).
  useDisableDefaultTab();
  const cm = useContextMenu();
  const { unread: inboxUnread } = useInboxUnreadCount();
  const { unread: rssUnread } = useRssUnreadCount();
  const settings = useEnsureSettings();
  const rightSideBarConfig = settings?.right_side_bar ?? null;
  const { cwds: recentCwds } = useCwdList();
  // Layout mode (Agentic / Classic) — toggles which column hosts the
  // chat card vs. the file / panel card. The terminal stays in the
  // center column in both modes (it's part of the "work area", not the
  // chat region). See hooks/layoutModeStore.ts for the persistence
  // semantics.
  const layoutMode = useLayoutMode();

  // ── Panel tab strip ────────────────────────────────────────────────
  // The strip's whole state — the open tabs, the active tab and the panel's
  // open state (closed / normal / expanded) — is owned by the pure
  // `panelTabs` reducer in lib/shared; the shell keeps no panel state of its
  // own. The tab bar and the right-bar descriptors keep today's shapes
  // through the module's compatibility adapter (`toLegacyTabs` + selectors)
  // while every open / toggle / activate / close below dispatches an action.
  const [panelTabsState, dispatchPanelTabs] = useReducer(
    panelTabsReducer,
    // Classic mode hides the chat card behind the right column being
    // closed, so the very first commit has to paint with the column open.
    // The `useReducer` initializer reads the persisted mode synchronously
    // so the first render is already correct — going through the React
    // subscription would commit the wrong state first and then flip on the
    // next tick, producing a visible flash.
    getLayoutModeSync() === "classic",
    (classic): PanelTabsState => ({
      ...createPanelTabsState(),
      mode: classic ? "normal" : "closed",
    }),
  );
  // Read through a ref where a callback must keep a stable identity yet act
  // on the latest state (kanban's "open session", the keyboard toggle).
  const panelTabsRef = useRef(panelTabsState);
  panelTabsRef.current = panelTabsState;
  /** Today's name for the panel open state — the right column's width and
   *  the panel bodies still read it directly. */
  const rightPanelState = panelTabsState.mode;
  const setPanelMode = useCallback((mode: PanelMode) => {
    dispatchPanelTabs({ type: "set_mode", mode });
  }, []);
  // The tab bar's props, derived through the compatibility adapter. Labels
  // resolve from `labelKey` on every render, so the open tabs follow a
  // locale switch instead of staying in the language they were opened in.
  const fileTabs = useMemo(
    () => toLegacyTabs(panelTabsState, t),
    [panelTabsState, t],
  );
  const activeFileTabId = panelTabsState.activeId;
  const activeRightPanelKind = selectActiveKind(panelTabsState);

  // Classic mode hides the chat card behind the right column being
  // closed, so the very first commit has to paint with the column
  // open. The reducer initializer above already handles the
  // *persisted* case by reading the mode synchronously from
  // localStorage; this effect covers the *in-session* switch — when the
  // user flips the Agentic ↔ Classic toggle after the page has
  // loaded, we re-open the right column so the chat isn't lost behind
  // a width:0 panel. Only auto-opens; manual close after the switch
  // is left alone until the next mode change. Reading the mode through
  // the ref keeps this keyed on layoutMode only — depending on the mode
  // too would re-fire after the auto-open and try to "re-open" a panel
  // that's already open.
  useEffect(() => {
    if (layoutMode === "classic" && panelTabsRef.current.mode === "closed") {
      dispatchPanelTabs({ type: "set_mode", mode: "normal" });
    }
  }, [layoutMode]);

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

  // When running inside the Electron shell iframe, subscribe to the shell's
  // refresh signal: the shell intercepts Ctrl+R and, instead of reloading the
  // whole shell (which would bounce the app back to "/"), asks this app to
  // reload itself in place — so the current route / ?session= stays intact.
  useEffect(() => {
    if (window.parent === window) return undefined;
    const onMessage = (e: MessageEvent) => {
      if (e.source === window.parent && e.data && e.data.type === "pi-reload") {
        window.location.reload();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
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
  const [cwdPickerOpen, setCwdPickerOpen] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [toolsMarketOpen, setToolsMarketOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Whole-sidebar flip card: false = front (Pi Bot / Sessions / Explorer),
  // true = the reserved back area. Owned here so the flip buttons rendered by
  // both faces can drive it.
  const [sidebarFlipped, setSidebarFlipped] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const chatInputRefs = useRef<Map<string, RefObject<ChatInputHandle | null>>>(new Map());
  // Text-selection toolbar scoped to the right side panel card (files /
  // panels). Reuses the same translation / copy / quote affordances as the
  // chat toolbar so selections inside the right panel can be acted on too.
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelSelection = useTextSelection(rightPanelRef);
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
    setChannelsOpen(false);
    setInboxOpen(false);
    setPaletteOpen(true);
  }, []);
  const closeTopPanel = useCallback(() => {}, []);

  // Session-level UI state (branch tree, system prompt, stats, context usage)
  // is owned by each tab controller. Only the active controller projects its
  // snapshot into this module-level bridge for the chat footer/right panels.
  const { branchTree, branchActiveLeafId, systemPrompt, isStreaming, agentRunning, currentModel, thinkingLevel } = useSessionUiState();
  const handleBranchLeafChange = useSessionLeafChange();
  // Trigger the active session controller to re-fetch & re-publish its
  // systemPrompt — surfaced as the BTW panel's header refresh button so a
  // session that got stuck on the "initializing" state can be prodded.
  const refreshSystemPrompt = useSystemPromptRefresh();

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

  // Incremented whenever the Git panel is opened, including reopening it
  // after the right panel was closed. GitPanel uses this to refresh status.
  const [gitPanelOpenRefreshToken, setGitPanelOpenRefreshToken] = useState(0);

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

  // Quote from the right panel inserts a markdown blockquote into the
  // active tab's chat input, matching the chat toolbar's behaviour.
  const handleRightPanelQuote = useCallback((text: string) => {
    getActiveChatInput()?.insertText(`> ${text}\n\n`);
  }, [getActiveChatInput]);

  const handleAtMention = useCallback((filePath: string) => {
    // Insert a cwd-relative path (no code-block backticks) so it reads as
    // plain text in chat. Falls back to the absolute path when no cwd is
    // active yet, e.g. before the user has picked a working directory.
    const cwd = selectedSession?.cwd ?? newSessionCwd;
    const displayPath = cwd ? getRelativeFilePath(filePath, cwd) : filePath;
    getActiveChatInput()?.insertText(displayPath);
  }, [getActiveChatInput, selectedSession?.cwd, newSessionCwd]);

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

  // Sign out: clears the auth cookie server-side then hard-navigates; the
  // login screen (rendered by the proxy redirect) appears immediately.
  const handleLogout = useCallback(() => {
    void fetch("/api/auth/session/logout", { method: "POST" })
      .catch(() => undefined)
      .finally(() => { window.location.href = "/login"; });
  }, []);

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
    // Switch immediately; the tab controller loads the session payload in the
    // background and reports the real metadata once it arrives.
    dispatchWorkspace({ type: "open_session_by_id", sessionId });
    closeTopPanel();
  }, [closeTopPanel]);

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
    dispatchPanelTabs({ type: "open_file", path: filePath, label: fileName });
  }, []);

  // Open the favorites tab — same pattern as file tabs.
  const handleOpenFavoritesTab = useCallback(() => {
    dispatchPanelTabs({ type: "open", kind: "favorites" });
  }, []);

  // Open the translate tab — same pattern as favorites.
  const handleOpenTranslateTab = useCallback(() => {
    dispatchPanelTabs({ type: "open", kind: "translate" });
  }, []);

  // Open the tool-calls tab. Toggles: clicking when it's already the active
  // tab hides the right panel entirely; otherwise activate (or create) the
  // tab. Mirrors the original drawer toggle behaviour.
  const handleOpenToolCallsTab = useCallback(() => {
    dispatchPanelTabs({ type: "toggle", kind: "toolCalls" });
  }, []);

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
        dispatchPanelTabs({
          type: "set_mode",
          mode: panelTabsRef.current.mode === "closed" ? "normal" : "closed",
        });
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
      // Space — focus chat input when not already focused.
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

  // Open the RSS panel — same pattern as translate.
  const handleOpenRssTab = useCallback(() => {
    dispatchPanelTabs({ type: "open", kind: "rss" });
  }, []);

  // Open the GitHub Trending panel — same pattern as rss / tokens.
  const handleOpenGithubTrendingTab = useCallback(() => {
    dispatchPanelTabs({ type: "open", kind: "githubTrending" });
  }, []);

  // Open the Notes panel. Unlike a fixed split, the notes panel renders its
  // list/editor internally and splits edit|preview only when the panel is
  // expanded; in the normal width it shows one pane and toggles via shortcut.
  const handleOpenNotesTab = useCallback(() => {
    dispatchPanelTabs({ type: "open", kind: "notes" });
  }, []);

  // Open the Kanban panel. Its spec declares `expanded` as the default open
  // state, so the four-column board gets width; the state machine only ever
  // upgrades the mode, never downgrades it.
  const handleOpenKanbanTab = useCallback(() => {
    dispatchPanelTabs({ type: "open", kind: "kanban" });
  }, []);

  // Kanban "Open session" jumps to the workspace session AND steps the right
  // panel down from expanded to normal (still open, but no longer full-width)
  // so the chat gets more room. Kept separate from handleOpenScheduledSession
  // (scheduler modal / command palette), which does not touch the right panel.
  const handleOpenKanbanSession = useCallback((sessionId: string) => {
    dispatchWorkspace({ type: "open_session_by_id", sessionId });
    if (panelTabsRef.current.mode === "expanded") {
      dispatchPanelTabs({ type: "set_mode", mode: "normal" });
    }
  }, []);

  // Open the Token-audit panel.
  const handleOpenTokensTab = useCallback(() => {
    dispatchPanelTabs({ type: "open", kind: "tokens" });
  }, []);

  // Open the LLM API audit panel.
  const handleOpenLlmAuditTab = useCallback(() => {
    dispatchPanelTabs({ type: "open", kind: "llmAudit" });
  }, []);

  // Open the Context panel — combines the session system prompt and tool list.
  const handleOpenContextTab = useCallback(() => {
    dispatchPanelTabs({ type: "toggle", kind: "context" });
  }, []);

  // Open the BTW (By the way) panel — read-only questions grounded in
  // the active session. The tab id / label stay constant ("BTW") so the
  // tab survives session switches; only the right-panel body re-renders
  // based on the active session id (which is captured via
  // `selectedSession?.id` at render time, not stored in the tab descriptor).
  const handleOpenBtwTab = useCallback(() => {
    dispatchPanelTabs({ type: "toggle", kind: "btw" });
  }, []);

  // `/btw` slash action (and the command-palette path): always open the BTW
  // tab (never toggle-close it) and bump the focus request so BtwPanel
  // focuses its input once mounted/visible.
  const [btwFocusRequest, setBtwFocusRequest] = useState(0);
  const handleSlashOpenBtw = useCallback(() => {
    dispatchPanelTabs({ type: "open", kind: "btw" });
    setBtwFocusRequest((n) => n + 1);
  }, []);

  // Open the git diff panel — same pattern as translate / rss / tokens.
  const handleOpenGitDiffTab = useCallback(() => {
    dispatchPanelTabs({ type: "open", kind: "gitDiff" });
    setGitPanelOpenRefreshToken((n) => n + 1);
  }, []);

  // Open the conversation-tree panel — card map of the session's tree.
  const handleOpenConversationTreeTab = useCallback(() => {
    dispatchPanelTabs({ type: "open", kind: "conversationTree" });
  }, []);

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
      setPanelMode("closed");
      return;
    }
    openTab();
  }, [activeFileTabId, rightPanelState, setPanelMode]);

  // GitPanel widens the right panel to "expanded"
  // when the user switches it into Log view, so the commit history gets
  // the full column. Stable callback: the GitPanel effect keys on it.
  const handleExpandGitPanel = useCallback(() => {
    setPanelMode("expanded");
  }, [setPanelMode]);

  const handleCloseFileTab = useCallback((tabId: string) => {
    dispatchPanelTabs({ type: "close", id: tabId });
  }, []);

  // Close every tab strictly to the left of `tabId` (the right-clicked one).
  // If the active tab is being closed, fall back to `tabId` (still open).
  const handleCloseLeftTabs = useCallback((tabId: string) => {
    dispatchPanelTabs({ type: "close_left", id: tabId });
  }, []);

  // Close every tab strictly to the right of `tabId`. If the active tab is
  // being closed, fall back to `tabId`.
  const handleCloseRightTabs = useCallback((tabId: string) => {
    dispatchPanelTabs({ type: "close_right", id: tabId });
  }, []);

  // Close every tab other than `tabId`. The right-clicked tab is preserved
  // (and becomes the active one if it wasn't already), so the panel never
  // collapses from this action.
  const handleCloseOtherTabs = useCallback((tabId: string) => {
    dispatchPanelTabs({ type: "close_others", id: tabId });
  }, []);

  // Build the per-tab right-click menu. Single tab → no batch actions shown.
  const handleTabContextMenu = useCallback((tabId: string, x: number, y: number, triggerElement: HTMLElement | null) => {
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
    cm.open({ x, y, items, triggerElement });
  }, [fileTabs, t, cm, handleCloseFileTab, handleCloseLeftTabs, handleCloseRightTabs, handleCloseOtherTabs]);

  const handleFileDeleted = useCallback((filePath: string) => {
    // The deleted path may be a directory — close every open file tab at or
    // under it, not just an exact match.
    const prefixSlash = filePath + "/";
    const prefixBackslash = filePath + "\\";
    for (const tab of fileTabs) {
      if (tab.kind !== "file") continue;
      const p = tab.filePath;
      if (p === filePath || p.startsWith(prefixSlash) || p.startsWith(prefixBackslash)) {
        handleCloseFileTab(tab.id);
      }
    }
  }, [fileTabs, handleCloseFileTab]);

  // Show chat after the initial URL restore is done (or immediately when no
  // session parameter was supplied). A draft tab exists even before a cwd is
  // selected, so the welcome/input view can render without a placeholder.
  const showChat = initialSessionRestored && workspace.tabOrder.length > 0;

  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) ?? null;

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);

  const [terminalHeight, setTerminalHeight] = useState<number>(() => {
    if (typeof window === "undefined") return 200;
    try {
      const v = Number(localStorage.getItem(TERMINAL_HEIGHT_KEY));
      const maxH = Math.max(MIN_TERMINAL_HEIGHT, window.innerHeight - 60 - MIN_CHAT_HEIGHT);
      if (Number.isFinite(v) && v >= MIN_TERMINAL_HEIGHT && v <= maxH) return v;
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

  const toggleTerminal = useCallback(() => {
    setTerminalOpen((v) => !v);
  }, []);

  // Fullscreen only has meaning while the terminal is open. Reset it when
  // the panel is closed from the right bar or the keyboard shortcut.
  useEffect(() => {
    if (!terminalOpen) setTerminalFullscreen(false);
  }, [terminalOpen]);

  // ── Right-bar button column context ──
  // Built late because it depends on toggleTerminal, which is declared
  // just above. The descriptor list itself is stable so the column only
  // re-renders on actual state change, not on every callback-identity
  // mutation. ctx is rebuilt every render anyway — RightBarColumn memoizes
  // what matters (cfg.order → ordered ids).
  const selectedSessionId = selectedSession?.id ?? null;
  const selectedCwd = selectedSession?.cwd ?? newSessionCwd ?? null;
  const [statusBar, setStatusBar] = useState({
    os: "—",
    shell: "—",
    channels: 0,
    cpu: null as number | null,
    memory: { rss: 0, heapUsed: 0, heapTotal: 0 },
    git: { branch: null as string | null, changedFiles: 0, additions: 0, deletions: 0 },
    runningSessions: 0,
    today: { tokens: 0, cost: 0 },
  });
  const [statusBarTime, setStatusBarTime] = useState(() => new Date());
  const [usefulTipOrder, setUsefulTipOrder] = useState<string[]>([...USEFUL_TIP_KEYS]);
  const [usefulTipIndex, setUsefulTipIndex] = useState(0);
  const [usefulTipVisible, setUsefulTipVisible] = useState(true);
  const { count: runningSessionCount } = useRunningSessions();

  useEffect(() => {
    setUsefulTipOrder(shuffleTips(USEFUL_TIP_KEYS));
  }, []);

  useEffect(() => {
    let transitionTimer: number | undefined;
    const timer = window.setInterval(() => {
      setUsefulTipVisible(false);
      transitionTimer = window.setTimeout(() => {
        setUsefulTipIndex((index) => (index + 1) % usefulTipOrder.length);
        setUsefulTipVisible(true);
      }, 350);
    }, 10000);
    return () => {
      window.clearInterval(timer);
      if (transitionTimer !== undefined) window.clearTimeout(transitionTimer);
    };
  }, [usefulTipOrder.length]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const query = selectedCwd ? `?cwd=${encodeURIComponent(selectedCwd)}` : "";
        const response = await fetch(`/api/status-bar${query}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) {
          setStatusBar((previous) => ({ ...data, runningSessions: previous.runningSessions }));
        }
      } catch {
        // The status bar is informational; retain the last known values.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedCwd]);

  useEffect(() => {
    const timer = window.setInterval(() => setStatusBarTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
    layoutMode,
    activeTabKind: activeRightPanelKind,
    hasOpenTabs: selectHasTabs(panelTabsState),
    selectedSessionId,
    selectedCwd,
    rssUnread,
    gitChangedCount,
    toolStats: {
      runningCount: toolStatsSnapshot.runningCount,
      totalCount: toolStatsSnapshot.totalCount,
    },
    t,
    toggleRightPanel: () =>
      setPanelMode(rightPanelState === "closed" ? "normal" : "closed"),
    toggleRightPanelTab: handleToggleRightPanelTab,
    setRightPanelState: setPanelMode,
    openTab: {
      translate: handleOpenTranslateTab,
      rss: handleOpenRssTab,
      gitDiff: handleOpenGitDiffTab,
      favorites: handleOpenFavoritesTab,
      tokens: handleOpenTokensTab,
      toolCalls: handleOpenToolCallsTab,
      conversationTree: handleOpenConversationTreeTab,
      llmAudit: handleOpenLlmAuditTab,
      context: handleOpenContextTab,
      btw: handleOpenBtwTab,
      githubTrending: handleOpenGithubTrendingTab,
      kanban: handleOpenKanbanTab,
      notes: handleOpenNotesTab,
    },
  };

  // Ctrl+` toggles the terminal panel (VS Code muscle memory).
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

  // Drag the bottom panel's top edge to resize (clamped to min/max).
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
  // and clicking it again reopens the same view. "file" kind has no
  // configurable button behind it so the lookup returns undefined and the
  // panel stays open.
  useEffect(() => {
    if (rightPanelState === "closed") return;
    if (activeRightPanelKind === null) return;
    const id = RIGHT_BAR_ID_FOR_TAB_KIND[activeRightPanelKind];
    if (id === undefined) return; // "file" kind — no configurable button
    if (isRightBarButtonVisible(rightSideBarConfig, id)) return;
    setPanelMode("closed");
  }, [rightPanelState, activeRightPanelKind, rightSideBarConfig, setPanelMode]);

  // ── Command palette context + command list ──
  // Re-built whenever any input changes (cheap; buildCommands is O(N) where
  // N is the number of declared commands). AppShell is the only place that
  // knows about every handler the palette may call.
  const commandContext = useMemo<CommandContext>(() => ({
    setTheme: theme.setPreset,
    setLocale,
    newSession: handleSlashNew,
    openSettings: () => setSettingsConfigOpen(true),
    openCwdPicker: () => setCwdPickerOpen(true),
    openModels: () => setModelsConfigOpen(true),
    openSkills: () => setSkillsConfigOpen(true),
    openPrompts: () => setPromptsConfigOpen(true),
    openScheduler: () => setSchedulerOpen(true),
    openChannels: () => setChannelsOpen(true),
    openToolMarket: () => setToolsMarketOpen(true),
    openFavoritesTab: handleOpenFavoritesTab,
    openTranslateTab: handleOpenTranslateTab,
    openToolCallsTab: handleOpenToolCallsTab,
    openTokensTab: handleOpenTokensTab,
    openGitDiffTab: handleOpenGitDiffTab,
    openLlmAuditTab: handleOpenLlmAuditTab,
    toggleSidebar: () => setSidebarOpen((v) => !v),
    toggleRightPanel: () => dispatchPanelTabs({
      type: "set_mode",
      mode: panelTabsRef.current.mode === "closed" ? "normal" : "closed",
    }),
    agentControls,
    hasSession: selectedSession !== null || newSessionCwd !== null,
    hasCwd: !!(selectedSession?.cwd ?? newSessionCwd),
  }), [
    theme.setPreset, setLocale, handleSlashNew,
    setCwdPickerOpen,
    handleOpenFavoritesTab,
    handleOpenTranslateTab, handleOpenToolCallsTab,
    handleOpenTokensTab, handleOpenGitDiffTab, handleOpenLlmAuditTab,
    agentControls,
    selectedSession, newSessionCwd,
  ]);

  const commands = useMemo<Command[]>(
    () => buildCommands(commandContext, t),
    [commandContext, t],
  );

  // ── Layout-mode building blocks ────────────────────────────────
  // The "chat card" (SessionTabBar + the active controller) and the
  // "panel card" (file/panel tab bar + content body) are each rendered
  // exactly once per layout. We build them once here so the JSX
  // returned below stays flat — the center / right columns just pick
  // which card goes where based on `layoutMode`. Terminal always lives
  // in the center column, so it stays in the render path that wraps
  // `chatCard` / `panelCard` at the JSX root.
  //
  // Two leading-control buttons live on the *column* position rather
  // than on the card they decorate, so the layout mode can swap them
  // without losing the user's muscle memory:
  //
  //   • `sidebarToggleLeading` always sits at the *center column*'s
  //     top-left corner — it hides/shows the global left sidebar.
  //     In Agentic mode that column hosts the chat, so the button is
  //     rendered as the SessionTabBar's `leadingControl`; in Classic
  //     mode the same button rides the panel card's tab bar instead.
  //
  //   • `expandPanelLeading` always sits at the *right column*'s
  //     top-left corner — it widens/narrows the right column.
  //     In Agentic mode it lives on the panel card's tab bar; in
  //     Classic mode it moves to the chat card's SessionTabBar.
  //
  // Because each button's column is fixed, swapping the buttons
  // between the two cards automatically puts them back in the same
  // physical location the user expects regardless of the mode.
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

  // Visibility for the right-column expand button:
  //   • Agentic: only when the panel actually has tabs to show — the
  //     button was originally panel-chrome, so an empty panel keeps
  //     its leading slot empty.
  //   • Classic: the button rides the chat card; show it whenever the
  //     right column is open at all (so the user can collapse/expand
  //     even if no file tabs are open yet).
  // The state machine's `selectCanExpand` absorbs both rules.
  const showExpandPanelLeading = selectCanExpand(panelTabsState, layoutMode);

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

  // Which leading control each card should expose. The mapping is the
  // inverse of the two buttons above: the chat card always rides the
  // center column, so it gets the sidebar toggle in Agentic mode and
  // the expand toggle in Classic mode; the panel card is the mirror.
  const chatLeadingControl = layoutMode === "agentic" ? sidebarToggleLeading : expandPanelLeading;
  const panelLeadingControl = layoutMode === "agentic" ? expandPanelLeading : sidebarToggleLeading;

  // Terminal fullscreen hides whichever card lives in the *center* column
  // (chat in Agentic, panel in Classic) so the xterm gets the whole work
  // area; the right column's card is untouched in both modes.
  const chatHiddenByTerminalFullscreen = terminalFullscreen && layoutMode === "agentic";
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
          leadingControl={chatLeadingControl}
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
              onOpenBtw={handleSlashOpenBtw}
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

  // Panel card — the right-side workspace that hosts file viewers,
  // tool lists, RSS, BTW, etc. Built once; the layout mode
  // decides whether it sits next to (Agentic) or instead of (Classic)
  // the chat card. The same expand / collapse right-panel state is
  // used in both modes: expanding still pushes the *other* center
  // card off-screen so the right column takes the full width.
  const panelCard = (
    <>
      {/* Right panel tab bar — mirrors the SessionTabBar chrome (one
          leading-control slot on the left, tabs filling the rest). The
          leading slot is filled by `panelLeadingControl` so the expand
          toggle in Agentic mode swaps to the sidebar toggle in Classic
          mode, keeping the right column's top-left corner semantics
          consistent across modes. */}
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "transparent", height: 34, borderRadius: "var(--panel-radius) var(--panel-radius) 0 0", overflow: "hidden", padding: "0 6px", gap: 2 }}>
        {panelLeadingControl && (
          <div style={{ flexShrink: 0, display: "flex", alignItems: "stretch" }}>
            {panelLeadingControl}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <TabBar
            tabs={fileTabs}
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

      {/* File content — same body routing as the original right panel.
          Pulled into a fragment-level child so the surrounding column
          handles flex / overflow without an extra wrapper div. */}
      <div ref={rightPanelRef} style={{ flex: 1, overflow: "hidden" }}>
        {activeFileTab?.kind === "favorites" ? (
          <CollectionPanel
            favoriteIds={favoriteIds}
            onSelectSession={handleSelectSession}
            onToggleFavorite={toggleSessionFavorite}
          />
        ) : activeFileTab?.kind === "translate" ? (
          <TranslatePanel />
        ) : activeFileTab?.kind === "toolCalls" ? (
          <ToolCallStatsTabBody />
        ) : activeFileTab?.kind === "file" ? (
          <FileViewer
            filePath={activeFileTab.filePath}
            cwd={selectedSession?.cwd ?? newSessionCwd ?? undefined}
            rightPanelState={rightPanelState}
          />
        ) : activeFileTab?.kind === "rss" ? (
          <RssPanel />
        ) : activeFileTab?.kind === "githubTrending" ? (
          <GitHubTrendingPanel />
        ) : activeFileTab?.kind === "tokens" ? (
          <TokensPanel />
        ) : activeFileTab?.kind === "llmAudit" ? (
          <LlmAuditPanel currentSessionId={selectedSession?.id ?? null} />
        ) : activeFileTab?.kind === "context" ? (
          <ContextPanel
            systemPrompt={systemPrompt}
            tools={tools}
          />
        ) : activeFileTab?.kind === "btw" ? (
          <BtwPanel
            mainSessionId={selectedSession?.id ?? null}
            cwd={selectedSession?.cwd ?? newSessionCwd ?? null}
            model={currentModel}
            systemPrompt={systemPrompt}
            thinkingLevel={thinkingLevel}
            onRefresh={refreshSystemPrompt}
            focusRequest={btwFocusRequest}
          />
        ) : activeFileTab?.kind === "gitDiff" ? (
          <GitPanel
            cwd={selectedSession?.cwd ?? newSessionCwd ?? null}
            openRefreshToken={gitPanelOpenRefreshToken}
            onExpandPanel={handleExpandGitPanel}
            isPanelExpanded={rightPanelState === "expanded"}
          />
        ) : activeFileTab?.kind === "conversationTree" ? (
          <ConversationTreePanel
            isStreaming={isStreaming}
            agentRunning={agentRunning}
            onCardClick={(card) => handleConversationTreeCardClick(card.id)}
          />
        ) : activeFileTab?.kind === "kanban" ? (
          <KanbanPanel
            defaultCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
            defaultModel={currentModel}
            defaultThinkingLevel={thinkingLevel}
            defaultTools={tools}
            onOpenSession={handleOpenKanbanSession}
            expanded={rightPanelState === "expanded"}
          />
        ) : activeFileTab?.kind === "notes" ? (
          <NotesPanel expanded={rightPanelState === "expanded"} />
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("No file open")}
          </div>
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
      onOpenModels={() => setModelsConfigOpen(true)}
      onOpenSkills={() => setSkillsConfigOpen(true)}
      onOpenPrompts={() => setPromptsConfigOpen(true)}
      onOpenScheduler={() => setSchedulerOpen(true)}
      onOpenChannels={() => setChannelsOpen(true)}
      onOpenToolMarket={() => setToolsMarketOpen(true)}
      onOpenSettings={() => setSettingsConfigOpen(true)}
      onOpenInbox={() => setInboxOpen(true)}
      onLogout={handleLogout}
      inboxUnread={inboxUnread}
      profileRefreshKey={profileRefreshKey}
      onFlip={() => setSidebarFlipped(true)}
    />
  );

  const sidebarBackContent = (
    <SidebarBackPanel onFlip={() => setSidebarFlipped(false)} />
  );

  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden", padding: "var(--panel-padding)", paddingBottom: 4, border: "1px solid var(--border)", borderTop: "none", background: "var(--bg)" }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", minWidth: 0, minHeight: 0 }}>
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
          border: "1px solid var(--panel-border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 200,
          width: sidebarOpen ? leftWidth : 0,
          minWidth: sidebarOpen ? leftWidth : 0,
        }}
      >
          <SidebarFlipContainer
            front={sidebarContent}
            back={sidebarBackContent}
            flipped={sidebarFlipped}
          />
      </div>

      {/* Drag handle removed — sidebar width is fixed. */}

      {/* Center column: the layout mode decides which card lives up top:
            - Agentic: chat card + terminal card (original behavior).
            - Classic: panel card + terminal card (chat moves to the
                       right column instead).
          The terminal stays anchored to this column in both modes — it
          is part of the "work area", not the chat region. flex-grow
          still animates the squeeze when the right panel goes expanded:
          center grows 1->0 while the right panel grows 0->1, so the
          whiteboard takeover slides instead of snapping. */}
      <div style={{ flex: rightPanelState === "expanded" ? "0 1 0%" : "1 1 0%", display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, gap: terminalOpen && !terminalFullscreen ? "var(--panel-gap-stack)" : 0, transition: "flex-grow 0.18s cubic-bezier(0.32, 0.72, 0, 1), gap 0.18s ease" }}>
        {layoutMode === "agentic" ? chatCard : (
          <div
            style={{
              display: terminalFullscreen ? "none" : "flex",
              flex: "1 1 0%",
              flexDirection: "column",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {panelCard}
          </div>
        )}

        {/* Drag handle sitting in the gap between the work card and the
            terminal card. Always mounted so the running pty/WS and layout
            survive collapse, but height: 0 when closed so it neither
            overlaps the work card (which would push it past the parent's
            overflow:hidden and clip its bottom border) nor occupies any
            space. Transitions alongside the gap and terminal card. */}
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

        {/* Terminal card — always mounted so the running pty/WS survive
            collapse. Height animates between terminalHeight (open) and 0
            (closed) via a flex-basis transition; border/radius collapse
            with the height so there's no orphan frame when hidden. */}
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

      {/* Right column: in Agentic mode this is the file / panel card,
          in Classic mode it's the chat card. Width still animates via
          rightPanelState so expand/collapse semantics are identical in
          both modes — the user expands whichever card is on the right
          and the center column shrinks to make room. */}
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
        {layoutMode === "agentic" ? panelCard : chatCard}
      </div>

      </div>

      {/* Bottom status bar: spans the sidebar, chat, and right panel, but not
          the separate right-side button column. */}
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
          onClick={() => handleToggleRightPanelTab(GIT_DIFF_TAB_ID, handleOpenGitDiffTab)}
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
        <span style={{ marginLeft: 10 }}>
          CPU {statusBar.cpu == null ? "—" : `${statusBar.cpu.toFixed(1)}%`} RAM {formatBytes(statusBar.memory.rss)}
        </span>
        <span
          aria-live="polite"
          style={{
            flex: 1,
            minWidth: 0,
            margin: "0 10px",
            overflow: "hidden",
            textAlign: "left",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            opacity: usefulTipVisible ? 1 : 0,
            transition: "opacity 350ms ease-in-out",
          }}
        >
          {t(usefulTipOrder[usefulTipIndex] ?? USEFUL_TIP_KEYS[0])}
        </span>
        <span style={{ marginLeft: "auto" }}>
          Today: {statusBar.today.tokens.toString().replace(/\B(?=(\d{4})+(?!\d))/g, ",")} tokens ${statusBar.today.cost.toFixed(4)}
        </span>
        <span style={{ marginLeft: 10 }}>
          {statusBarTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </div>
      </div>

      {/* Right button bar — every toggle is driven by the
          components/rightBar descriptor registry now. Adding a new button
          is a one-line append to RIGHT_BAR_DESCRIPTORS. */}
      <RightBarColumn cfg={rightSideBarConfig} ctx={rightBarCtx} />
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
    <CwdPicker
      cwd={selectedSession?.cwd ?? newSessionCwd ?? null}
      onCwdChange={handleCwdPicked}
      openSignal={cwdPickerOpen}
      onOpenSignalHandled={() => setCwdPickerOpen(false)}
      hideTrigger
    />
    {schedulerOpen && (
      <SchedulerModal
        open={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        onOpenSession={handleOpenScheduledSession}
      />
    )}
    {toolsMarketOpen && <ToolsMarketModal open={toolsMarketOpen} onClose={() => setToolsMarketOpen(false)} />}
    {channelsOpen && (
      <ChannelsModal
        open={channelsOpen}
        onClose={() => setChannelsOpen(false)}
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
    <TextSelectionToolbar
      state={rightPanelSelection}
      onQuote={handleRightPanelQuote}
      onHide={rightPanelSelection.hide}
    />
    {/* Single global translate bubble — mounted here (not inside ChatWindow)
        so it also works over fullscreen modals such as SkillsConfig. It is
        position:fixed + z-index 8000, above the modal backdrop (1000). */}
    <TranslateBubble />
    </>
  );
}

function ContextPanel({ systemPrompt, tools }: { systemPrompt: string | null; tools: ToolInfo[] }) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [hoveredJumpId, setHoveredJumpId] = useState<string | null>(null);
  // Delayed close so the menu doesn't vanish mid-traversal from the trigger
  // button across the small gap into the menu (150ms grace, cancelled on re-entry).
  const jumpCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelJumpClose = useCallback(() => {
    if (jumpCloseTimerRef.current !== null) {
      clearTimeout(jumpCloseTimerRef.current);
      jumpCloseTimerRef.current = null;
    }
  }, []);
  const scheduleJumpClose = useCallback(() => {
    cancelJumpClose();
    jumpCloseTimerRef.current = setTimeout(() => setJumpOpen(false), 150);
  }, [cancelJumpClose]);
  useEffect(() => () => { if (jumpCloseTimerRef.current !== null) clearTimeout(jumpCloseTimerRef.current); }, []);
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
  const jumpTo = useCallback((id: string) => {
    scrollRef.current?.querySelector<HTMLElement>(`[data-context-anchor="${id}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  // Fine-grained anchors inside the base prompt (Available tools / Guidelines /
  // Pi documentation / Append) — only shown when the heading is actually present.
  const baseBlocks = useMemo(
    () => segments.flatMap((seg) => (seg.kind === "base" ? splitBaseBlocks(seg.text) : [])),
    [segments],
  );
  const baseAnchors = useMemo(() => {
    const present = new Set(baseBlocks.map((b) => b.anchor).filter((a): a is string => a !== null));
    const items: { id: string; label: string; color: string }[] = [];
    if (systemPrompt) items.push({ id: "base", label: t("Pi base + Append"), color: "var(--text-dim)" });
    if (present.has("available-tools")) items.push({ id: "available-tools", label: t("Available tools"), color: "var(--text-dim)" });
    if (present.has("guidelines")) items.push({ id: "guidelines", label: t("Guidelines"), color: "var(--text-dim)" });
    if (present.has("pi-docs")) items.push({ id: "pi-docs", label: t("Pi documentation"), color: "var(--text-dim)" });
    if (present.has("append")) items.push({ id: "append", label: t("Append"), color: "var(--text-dim)" });
    if (present.has("skills")) items.push({ id: "skills", label: t("Skills"), color: "var(--accent)" });
    return items;
  }, [systemPrompt, baseBlocks, t]);
  // Jump menu groups: base prompt sections, per-AGENTS.md instructions, tools.
  const jumpGroups = useMemo(
    () =>
      [
        ...(baseAnchors.length > 0 ? [{ label: null, items: baseAnchors }] : []),
        ...(agentsSegments.length > 0
          ? [{
              label: t("AGENTS.md"),
              items: agentsSegments.map((seg, idx) => ({ id: `agents-${idx}`, label: seg.path, color: pathColor.get(seg.path)! })),
            }]
          : []),
        { label: null, items: [{ id: "tools", label: t("Tools"), color: "var(--accent)" }] },
      ].filter((group) => group.items.length > 0),
    [baseAnchors, agentsSegments, pathColor, t],
  );

  return (
    <div ref={scrollRef} style={{ height: "100%", overflowY: "auto", background: "transparent", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
      {/* Floating quick-jump button (top-right). The sticky wrapper is
          height:0 so it overlays the scroll content without reserving a row,
          and the button + menu live in an absolutely-positioned shell. The
          shell is a DOM child of the wrapper, so hovering the menu keeps the
          wrapper (and thus the open state) alive; closing is deferred 150ms
          so crossing the 2px gap never collapses the menu prematurely. */}
      <div style={{ position: "sticky", top: 0, height: 0, zIndex: 3 }} onMouseLeave={scheduleJumpClose}>
        <div style={{ position: "absolute", top: 8, right: 8 }} onMouseEnter={() => { cancelJumpClose(); setJumpOpen(true); }}>
          <button
            type="button"
            aria-label={t("Quick jump")}
            aria-expanded={jumpOpen}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 6, background: jumpOpen ? "var(--bg-hover)" : "var(--bg-panel)", color: "var(--text-muted)", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
          </button>
          {jumpOpen && (
            <div
              onMouseEnter={cancelJumpClose}
              style={{ position: "absolute", top: "calc(100% + 2px)", right: 0, width: 244, maxHeight: 340, overflowY: "auto", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 10px 28px rgba(0,0,0,0.25)", padding: 6, zIndex: 4 }}
            >
              {jumpGroups.map((group, gi) => (
                <div key={gi} style={{ padding: "2px 0" }}>
                  {group.label && <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 8px 2px" }}>{group.label}</div>}
                  {group.items.map((item) => {
                    const hovered = hoveredJumpId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => { jumpTo(item.id); cancelJumpClose(); setJumpOpen(false); }}
                        onMouseEnter={() => setHoveredJumpId(item.id)}
                        onMouseLeave={() => setHoveredJumpId(null)}
                        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px", borderRadius: 5, border: "none", background: hovered ? "var(--bg-hover)" : "transparent", color: "var(--text-muted)", font: "inherit", fontSize: 11, textAlign: "left", cursor: "pointer" }}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: item.color }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: item.id.startsWith("agents-") ? "var(--font-mono)" : "inherit" }}>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <section data-context-anchor="base" style={{ scrollMarginTop: 42, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{t("System Prompts")}</div>
        {systemPrompt ? (
          <div>
            {agentsSegments.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 10, fontSize: 11, color: "var(--text-muted)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--text-dim)" }} /><span>{t("Pi base + Append")}</span></div>
                {agentsSegments.map((seg) => <div key={seg.path} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: pathColor.get(seg.path)! }} /><span style={{ fontFamily: "var(--font-mono)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={seg.path}>{seg.path}</span></div>)}
              </div>
            )}
            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
              {segments.map((seg, idx) => {
                if (seg.kind === "base") {
                  // Cut the base blob at its known headings so quick-jump can
                  // target per-section anchors instead of the whole block.
                  const blocks = splitBaseBlocks(seg.text);
                  return (
                    <span key={`base-${idx}`}>
                      {blocks.map((block, bi) => (
                        <span
                          key={bi}
                          data-context-anchor={block.anchor ?? undefined}
                          style={block.anchor ? { display: "block", scrollMarginTop: 44 } : undefined}
                        >
                          {highlightBasePrompt(block.text, `base-${idx}-${bi}`)}
                        </span>
                      ))}
                    </span>
                  );
                }
                const color = pathColor.get(seg.path)!;
                return <span key={`agents-${idx}-${seg.path}`} data-context-anchor={`agents-${agentsSegments.indexOf(seg)}`} style={{ scrollMarginTop: 44, display: "block", borderLeft: `3px solid ${color}`, background: `${color}14`, marginTop: 8, marginBottom: 8, paddingLeft: 10, paddingTop: 4, paddingBottom: 4 }}><div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={seg.path}>{seg.path}</div>{seg.text}</span>;
              })}
            </div>
          </div>
        ) : <div style={{ fontStyle: "italic" }}>{t("System prompt is empty (tools are disabled)")}</div>}
      </section>
      <section data-context-anchor="tools" style={{ scrollMarginTop: 42, padding: "12px 16px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{t("Tools")}</div>
        {sortedTools.length === 0 ? (
          <div style={{ fontStyle: "italic" }}>{t("Loading tools...")}</div>
        ) : (
          <div>
            {sortedTools.map((tool) => {
              // `active` comes from the server's `get_tools` (per-session
              // `getActiveToolNames()`); the catalog lists every available tool
              // and greys out the ones this session didn't enable.
              const enabled = tool.active === true;
              return (
                <div key={tool.name} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid color-mix(in srgb, var(--border) 55%, transparent)", opacity: enabled ? 1 : 0.5 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: enabled ? "var(--accent)" : "var(--text-dim)", flexShrink: 0, marginTop: 4 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: enabled ? "var(--text)" : "var(--text-dim)", fontWeight: enabled ? 500 : 400, fontFamily: "var(--font-mono)" }}>{tool.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5 }}>{tool.description || t("No description")}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Tool-calls vertical button ────────────────────────────────────────────
// Mirrors the style of the other right-bar buttons (favorites /
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
