"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { SessionInfo, Workspace, WorkspacesResponse } from "@/lib/shared/types";
import { FileExplorer } from "../files/FileExplorer";
import { notifyMutated } from "@/lib/client/git-status-store";
import { ProfileBlock } from "../settings/ProfileBlock";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "../ui/Toast";
import { Tooltip } from "../ui/Tooltip";
import { MorphToggleIcon } from "../ui/MorphToggleIcon";
import { RefreshIconButton } from "../ui/RefreshIconButton";
import { CHECK, CHEVRONS_UP } from "@/lib/client/icon-paths";
import { MultiCwdList, type CwdSessionsState } from "./MultiCwdList";
import { TodaySessionsList } from "./TodaySessionsList";
import { CwdSessionsModal } from "./CwdSessionsModal";
import { SidebarSection } from "../ui/SidebarSection";
import { GrokBotStage } from "../grokbot/GrokBotStage";
import { GrokBotLab } from "../grokbot/GrokBotLab";
import { useRunningSessions } from "@/hooks/runningSessionsStore";
import {
  SESSION_PAGE_SIZE_GROUPED,
  SIDEBAR_LOAD_MORE_THRESHOLD_PX,
  WORKSPACE_PAGE_SIZE,
  decideChainLoad,
  decideLoadMoreOnScroll,
  mergePage,
  refreshLimit,
  showChainFallback,
} from "@/lib/shared/sidebar-paging";
import {
  TODAY_MIN_ROWS,
  TODAY_VISIBLE_ROWS,
  sidebarListHeightPx,
} from "@/lib/shared/sidebar-section";

interface Props {
  selectedSession?: SessionInfo | null;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  initialSessionId?: string | null;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  onSessionRenamed?: (sessionId: string, name: string) => void;
  onNewSession?: (cwd?: string) => void;
  // cwd of the active chat context (selected session or in-flight new
  // session). The sidebar no longer renders an editable picker — this is
  // only consumed by FileExplorer + the top "+" button (canNew check).
  selectedCwd?: string | null;
  onOpenFile?: (filePath: string, fileName: string) => void;
  explorerRefreshKey?: number;
  onAtMention?: (filePath: string) => void;
  onOpenSearch?: () => void;
  onFileDeleted?: (filePath: string) => void;
  favoriteIds?: string[];
  onToggleFavorite?: (sessionId: string) => void;
  onOpenPrompts?: () => void;
  onOpenScheduler?: () => void;
  onOpenChannels?: () => void;
  onOpenMcp?: () => void;
  onOpenSettings?: () => void;
  onLogout?: () => void;
  profileRefreshKey?: number;
}

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean): string {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setDisplay(target);
      return;
    }
    iterRef.current = 0;
    const totalFrames = target.length * 4;

    const step = () => {
      iterRef.current += 1;
      const progress = iterRef.current / totalFrames;
      const resolved = Math.floor(progress * target.length);

      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < resolved) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join("")
      );

      if (iterRef.current < totalFrames) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, running]);

  return display;
}

function PiAgentTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = showVersion ? `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}p${process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}` : "Pi Work";
  const display = useScramble(target, scrambling);

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    setScrambling(true);
    setTimeout(() => setScrambling(false), (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100);
  }, []);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    const next = !showVersion;
    triggerScramble(next);

    if (next) {
      revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
    }
  }, [showVersion, triggerScramble]);

  useEffect(() => () => { if (revertTimerRef.current) clearTimeout(revertTimerRef.current); }, []);

  return (
    <button
      onClick={handleClick}
      style={{
        background: "none", border: "none", padding: 0, cursor: "default",
        fontWeight: 700, fontSize: 18, letterSpacing: "-0.01em",
        color: showVersion ? "var(--accent)" : "var(--text)",
        fontFamily: "var(--font-mono)",
        whiteSpace: "nowrap",
      }}
    >
      {display === "Pi Work" ? (
        <>{display}</>
      ) : display}
    </button>
  );
}

const EXPANDED_CWDS_KEY = "pi-work.expandedCwds";

export function SessionSidebar({ selectedSession, selectedSessionId, onSelectSession, initialSessionId, onInitialRestoreDone, refreshKey, onSessionDeleted, onSessionRenamed, onNewSession, selectedCwd: selectedCwdProp, onOpenFile, explorerRefreshKey, onAtMention, onOpenSearch, onFileDeleted, favoriteIds = [], onToggleFavorite, onOpenMcp, onOpenPrompts, onOpenScheduler, onOpenChannels, onOpenSettings, onLogout, profileRefreshKey }: Props) {
  const { byId: runningById } = useRunningSessions();
  const { t } = useI18n();
  const toast = useToast();
  const [labOpen, setLabOpen] = useState(false);
  // Cwd whose paged-search modal is currently open. Null when no modal
  // is showing. The "View more sessions" affordance on each cwd group
  // header sets this; the modal closes by setting it back to null.
  const [cwdSessionsModalCwd, setCwdSessionsModalCwd] = useState<string | null>(null);

  // Multi-cwd view: workspaces list (top-level, cwd-keyed) + per-cwd
  // session loaders (lazy, paged 3 at a time).
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [nextWorkspaceCursor, setNextWorkspaceCursor] = useState<string | null>(null);
  const [hasMoreWorkspaces, setHasMoreWorkspaces] = useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [loadingMoreWorkspaces, setLoadingMoreWorkspaces] = useState(false);
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null);
  const [perCwdSessions, setPerCwdSessions] = useState<Record<string, CwdSessionsState>>({});
  // Expand state for non-active cwds; the active cwd defaults to expanded
  // when present. Persisted to localStorage.
  const [expandedCwds, setExpandedCwds] = useState<Record<string, boolean>>({});
  const cwdHeaderRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Ref to the Sessions section's scroll container (owned by SidebarSection).
  // The list pages in on its scroll events. `sessionsScrollEl` mirrors it in
  // state so the scroll/chain effects re-run when the container remounts
  // (collapsing the section unmounts it; reopening mounts a new node).
  const sessionsScrollRef = useRef<HTMLDivElement | null>(null);
  const [sessionsScrollEl, setSessionsScrollEl] = useState<HTMLDivElement | null>(null);
  const attachSessionsScroll = useCallback((el: HTMLDivElement | null) => {
    sessionsScrollRef.current = el;
    setSessionsScrollEl(el);
  }, []);
  // Once the list cannot scroll and a few pages have been chained in, the
  // manual "load more projects" fallback appears. Reset by a user scroll or
  // click.
  const [showFallbackLoadMore, setShowFallbackLoadMore] = useState(false);
  const chainLoadCountRef = useRef(0);
  // Current workspace / per-cwd depth, read by the refresh path so a refresh
  // keeps the loading depth instead of snapping back to page one. Kept in
  // refs because refreshAll must stay referentially stable for the
  // refreshKey effect (reading live state in a callback would re-fire it on
  // every render).
  const workspacesRef = useRef<Workspace[]>([]);
  const perCwdSessionsRef = useRef<Record<string, CwdSessionsState>>({});
  const workspaceFetchInFlightRef = useRef(false);

  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [todayOpen, setTodayOpen] = useState(true);
  const [todayRefreshSignal, setTodayRefreshSignal] = useState(0);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerCollapseKey, setExplorerCollapseKey] = useState(0);
  // Number of expanded folders in the explorer (reported by FileExplorer).
  // 0 → the "collapse all" button has nothing to do and is greyed out.
  const [explorerExpandedCount, setExplorerExpandedCount] = useState(0);
  // One-shot ✓ confirmation after a collapse-all click (same REFRESH→CHECK
  // pattern as the refresh button), so the fold-back is visibly acknowledged.
  const [explorerCollapseDone, setExplorerCollapseDone] = useState(false);
  const explorerCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceAbortRef = useRef<AbortController | null>(null);

  const triggerExplorerRefresh = useCallback(() => {
    setExplorerKey((k) => k + 1);
    // Also poke the git status store so any new/modified file surfaces
    // its badge immediately rather than waiting up to 3s for the next
    // scheduled poll. No-op when the active cwd isn't being tracked
    // (e.g. user switched away, or cwd is not a git repo).
    if (selectedCwdProp) notifyMutated(selectedCwdProp);
  }, [selectedCwdProp]);

  // Collapse every expanded folder in the explorer. FileExplorer watches
  // `explorerCollapseKey` and clears its `expandedPaths` set when this
  // bumps. Bumping (rather than resetting to 0) means clicking twice in
  // a row still fires — without it the second click would be a no-op.
  // The ✓ flash gives the instantaneous fold-back a visible confirmation;
  // the button then greys out via the expanded-count report.
  const triggerCollapseAll = useCallback(() => {
    setExplorerCollapseKey((k) => k + 1);
    setExplorerCollapseDone(true);
    if (explorerCollapseTimerRef.current) clearTimeout(explorerCollapseTimerRef.current);
    explorerCollapseTimerRef.current = setTimeout(() => setExplorerCollapseDone(false), 700);
  }, []);

  // Keep the refresh path's depth snapshots in sync with state. Declared
  // before the refresh effects so a refresh sees the latest depth.
  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);
  useEffect(() => {
    perCwdSessionsRef.current = perCwdSessions;
  }, [perCwdSessions]);

  // Persist expand state to localStorage. Stored as a flat object
  // { [cwd]: boolean } — last-writer-wins on the cwd key.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(EXPANDED_CWDS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const cleaned: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "boolean") cleaned[k] = v;
      }
      setExpandedCwds(cleaned);
    } catch {
      // ignore corrupted entries
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_CWDS_KEY, JSON.stringify(expandedCwds));
    } catch {
      // ignore (private mode / quota)
    }
  }, [expandedCwds]);

  // Fetch one page of workspaces. Pass `mode: "reset"` to start over
  // (cursor=null, replace list), `mode: "append"` to extend. Aborts any
  // in-flight request so the previous page's response can't land after a
  // refresh.
  const fetchWorkspaces = useCallback(async (
    cursor: string | null,
    mode: "reset" | "append",
    limitOverride?: number,
  ) => {
    workspaceAbortRef.current?.abort();
    const controller = new AbortController();
    workspaceAbortRef.current = controller;
    // Synchronous guard shared by the scroll and chain-load paths: a second
    // append cannot start while this request is still in flight (state flips
    // only after the next render).
    workspaceFetchInFlightRef.current = true;
    if (mode === "reset") setLoadingWorkspaces(true);
    else setLoadingMoreWorkspaces(true);
    setWorkspaceLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limitOverride ?? WORKSPACE_PAGE_SIZE));
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/workspaces?${params.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as WorkspacesResponse;
      if (controller.signal.aborted) return;
      if (mode === "reset") {
        setWorkspaces(data.workspaces);
      } else {
        setWorkspaces((prev) => mergePage(prev, data.workspaces, (w) => w.cwd));
      }
      setNextWorkspaceCursor(data.nextCursor);
      setHasMoreWorkspaces(data.nextCursor !== null);
      // The ✓ flash is fired by the RefreshIconButton itself when the user
      // clicks it — see the Sessions section header. We deliberately don't
      // toggle a "done" state here because the ✓ should reflect user
      // intent (button click), not the completion of the network round-trip.
    } catch (e) {
      if (controller.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      setWorkspaceLoadError(msg);
      if (mode === "reset") {
        toast.show({ kind: "error", message: msg });
      }
    } finally {
      if (workspaceAbortRef.current === controller) {
        workspaceFetchInFlightRef.current = false;
      }
      if (!controller.signal.aborted) {
        if (mode === "reset") setLoadingWorkspaces(false);
        else setLoadingMoreWorkspaces(false);
      }
    }
  }, [toast]);

  // Per-cwd session loader. Used both for the lazy first-page fetch
  // (mode: "reset") and the "Load more" button (mode: "append"). Reads
  // `expandedCwds` from state; merged into the existing entry for the cwd.
  const fetchCwdSessions = useCallback(async (
    cwd: string,
    cursor: string | null,
    mode: "reset" | "append",
    limitOverride?: number,
  ) => {
    setPerCwdSessions((prev) => {
      const existing = prev[cwd];
      const base: CwdSessionsState = existing ?? {
        sessions: [],
        cursor: null,
        hasMore: false,
        loading: false,
        loadingMore: false,
        loadError: null,
      };
      return {
        ...prev,
        [cwd]: {
          ...base,
          // Silent refresh: keep the current rows on reset (data still
          // shows while the request is in flight, no flash of the
          // "Loading sessions..." placeholder). The list is only replaced
          // once the fresh page arrives below.
          sessions: base.sessions,
          loading: mode === "reset",
          loadingMore: mode === "append",
          loadError: null,
        },
      };
    });

    try {
      const params = new URLSearchParams();
      params.set("cwd", cwd);
      params.set("limit", String(limitOverride ?? SESSION_PAGE_SIZE_GROUPED));
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/sessions?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { sessions: SessionInfo[]; nextCursor: string | null };
      setPerCwdSessions((prev) => {
        const existing = prev[cwd];
        const base: CwdSessionsState = existing ?? {
          sessions: [],
          cursor: null,
          hasMore: false,
          loading: false,
          loadingMore: false,
          loadError: null,
        };
        const nextSessions = mode === "reset"
          ? data.sessions
          : mergePage(base.sessions, data.sessions, (s) => s.id);
        return {
          ...prev,
          [cwd]: {
            ...base,
            sessions: nextSessions,
            cursor: data.nextCursor,
            hasMore: data.nextCursor !== null,
            loading: false,
            loadingMore: false,
          },
        };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPerCwdSessions((prev) => {
        const existing = prev[cwd];
        if (!existing) return prev;
        return {
          ...prev,
          [cwd]: { ...existing, loading: false, loadingMore: false, loadError: msg },
        };
      });
    }
  }, []);

  // Synchronize historical-session selection with the sidebar: reveal the
  // target cwd, refresh its first page, and bring the active group into view.
  // MultiCwdList injects the selected session when it falls outside that
  // first page (the same rule as a click), so this effect never prepends.
  useEffect(() => {
    const cwd = selectedSession?.cwd;
    if (!cwd) return;

    setExpandedCwds((prev) => prev[cwd] === true ? prev : { ...prev, [cwd]: true });
    void fetchCwdSessions(cwd, null, "reset");

    const frame = requestAnimationFrame(() => {
      cwdHeaderRefs.current[cwd]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedSession?.id, selectedSession?.cwd, fetchCwdSessions]);

  // Refresh handler — reload workspaces + every loaded cwd's sessions while
  // keeping the depth the user has scrolled to. `refreshLimit` sizes each
  // request to what is already on screen (never less than one page), and the
  // returned cursor lets paging continue from that depth. Because the row
  // count does not change, `scrollTop` is left alone.
  const refreshAll = useCallback(() => {
    const workspaceDepth = workspacesRef.current.length;
    void fetchWorkspaces(null, "reset", refreshLimit(WORKSPACE_PAGE_SIZE, workspaceDepth));

    const targets: Array<{ cwd: string; loadedCount: number }> = [];
    for (const [cwd, state] of Object.entries(perCwdSessionsRef.current)) {
      if (state.sessions.length > 0 || state.loading) {
        targets.push({ cwd, loadedCount: state.sessions.length });
      }
    }
    if (targets.length > 0) {
      setPerCwdSessions((prev) => {
        let changed = false;
        const next: Record<string, CwdSessionsState> = {};
        for (const [cwd, state] of Object.entries(prev)) {
          if (state.sessions.length > 0 || state.loading) {
            // Silent refresh: keep rows, just rewind the cursor; the fresh
            // page replaces the rows once it arrives.
            next[cwd] = { ...state, cursor: null, hasMore: false };
            changed = true;
          } else {
            next[cwd] = state;
          }
        }
        return changed ? next : prev;
      });
    }
    for (const { cwd, loadedCount } of targets) {
      void fetchCwdSessions(
        cwd,
        null,
        "reset",
        refreshLimit(SESSION_PAGE_SIZE_GROUPED, loadedCount),
      );
    }
  }, [fetchWorkspaces, fetchCwdSessions]);

  // Back-compat alias used by inline rename/delete handlers that pre-date
  // the multi-cwd view: "the sidebar should reflect the new state" still
  // means "go back to page 1 and show a green check".
  const loadSessions = useCallback(() => {
    refreshAll();
  }, [refreshAll]);

  // refreshKey is bumped on session creation / rename / deletion / agent end.
  // Reload workspaces AND each loaded cwd's session page so renames and new
  // sessions show up in the sidebar immediately — fetchWorkspaces alone only
  // refreshes workspace-level metadata, not the per-cwd session rows (whose
  // name/modified come from /api/sessions?cwd=).
  useEffect(() => {
    refreshAll();
  }, [refreshKey, refreshAll]);

  // Auto-load: any cwd that enters the workspaces list AND is currently
  // expanded (default true) needs its first session page fetched. Tracking
  // via a ref avoids re-firing on every perCwdSessions tick — the effect
  // only does real work the first time a cwd appears or its expanded state
  // flips from false → true.
  const initializedCwdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const ws of workspaces) {
      if (initializedCwdsRef.current.has(ws.cwd)) continue;
      initializedCwdsRef.current.add(ws.cwd);
      const expanded = expandedCwds[ws.cwd] ?? true;
      if (!expanded) continue;
      const state = perCwdSessions[ws.cwd];
      if (state && (state.sessions.length > 0 || state.loading)) continue;
      void fetchCwdSessions(ws.cwd, null, "reset");
    }
  }, [workspaces, expandedCwds, perCwdSessions, fetchCwdSessions]);

  // Merge the shared running-session snapshot into the visible rows. The
  // singleton store owns the only /api/sessions/running poller.
  useEffect(() => {
    if (runningById.size === 0) return;
    setPerCwdSessions((prev) => {
      let changed = false;
      const next: Record<string, CwdSessionsState> = {};
      for (const [cwd, state] of Object.entries(prev)) {
        let rowChanged = false;
        const rows = state.sessions.map((session) => {
          if (runningById.has(session.id) && session.running !== runningById.get(session.id)) {
            rowChanged = true;
            return { ...session, running: runningById.get(session.id)! };
          }
          return session;
        });
        if (rowChanged) {
          changed = true;
          next[cwd] = { ...state, sessions: rows };
        } else {
          next[cwd] = state;
        }
      }
      return changed ? next : prev;
    });
  }, [runningById]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  const restoredRef = useRef(false);

  // Auto-restore session from URL on first load.
  // In paged mode the initial-session restore is best-effort: if the target
  // session is on a page we haven't fetched yet, fetch it via the lite info
  // endpoint and merge into the perCwdSessions list before resolving.
  useEffect(() => {
    if (loadingWorkspaces) return;

    if (initialSessionId && !restoredRef.current) {
      restoredRef.current = true;
      void (async () => {
        try {
          const res = await fetch(`/api/sessions/${encodeURIComponent(initialSessionId)}/info`);
          if (res.ok) {
            const data = (await res.json()) as { session: SessionInfo };
            // Hand the full row to the selection; MultiCwdList injects it into
            // its cwd group when it falls outside the loaded page — the same
            // rule as clicking a session, so the landing spot matches.
            onSelectSession(data.session, true);
            return;
          }
        } catch { /* fall through */ }
        onInitialRestoreDone?.();
      })();
    }
  }, [loadingWorkspaces, initialSessionId, onSelectSession, onInitialRestoreDone]);

  // Keep the active cwd at the top. Historical-session jumps can target a
  // cwd outside the currently loaded workspace page, so synthesize its row
  // from the selected session until pagination reaches the real aggregate.
  const activeWorkspace = selectedCwdProp
    ? workspaces.find((workspace) => workspace.cwd === selectedCwdProp)
      ?? (selectedSession?.cwd === selectedCwdProp
        ? {
            cwd: selectedSession.cwd,
            lastUsed: selectedSession.modified,
            totalSessions: 1,
            runningCount: selectedSession.running ? 1 : 0,
            firstMessage: selectedSession.firstMessage,
            latestSessionName: selectedSession.name,
          }
        : null)
    : null;
  const orderedWorkspaces = activeWorkspace
    ? [activeWorkspace, ...workspaces.filter((workspace) => workspace.cwd !== activeWorkspace.cwd)]
    : workspaces;

  const toggleExpandCwd = useCallback((cwd: string) => {
    setExpandedCwds((prev) => {
      // Every cwd defaults to expanded; if absent in state, treat current
      // as true then flip.
      const current = prev[cwd] ?? true;
      return { ...prev, [cwd]: !current };
    });
  }, []);

  const handleToggleExpand = useCallback((cwd: string) => {
    toggleExpandCwd(cwd);
    // Session loading is handled by the auto-load useEffect above, which
    // fires whenever expandedCwds changes. No need to trigger here.
  }, [toggleExpandCwd]);

  const loadMoreCwdSessions = useCallback((cwd: string) => {
    const state = perCwdSessions[cwd];
    if (!state?.cursor || state.loadingMore) return;
    void fetchCwdSessions(cwd, state.cursor, "append");
  }, [perCwdSessions, fetchCwdSessions]);

  const openCwdSessions = useCallback((cwd: string) => {
    setCwdSessionsModalCwd(cwd);
  }, []);

  // ── Sessions infinite scroll ────────────────────────────────────────────
  // The real scroll container lives inside SidebarSection (`scrollRef`); the
  // list itself is a plain content div. A scroll near the bottom asks for the
  // next workspace page. `workspaceFetchInFlightRef` is the synchronous
  // guard so a fast scroll cannot stack two requests for the same cursor.
  const readSessionsMetrics = useCallback(() => {
    const el = sessionsScrollRef.current;
    if (!el) return null;
    return { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight };
  }, []);

  const loadMoreWorkspaces = useCallback(() => {
    if (workspaceFetchInFlightRef.current) return;
    if (!hasMoreWorkspaces || !nextWorkspaceCursor) return;
    void fetchWorkspaces(nextWorkspaceCursor, "append");
  }, [hasMoreWorkspaces, nextWorkspaceCursor, fetchWorkspaces]);

  useEffect(() => {
    const el = sessionsScrollEl;
    if (!el || !sessionsOpen) return;
    const onScroll = () => {
      // The user is scrolling, so the container can scroll: the chain-load
      // fallback is not needed and its counter resets.
      chainLoadCountRef.current = 0;
      if (decideLoadMoreOnScroll({
        metrics: readSessionsMetrics(),
        thresholdPx: SIDEBAR_LOAD_MORE_THRESHOLD_PX,
        hasMore: hasMoreWorkspaces,
        loading: loadingWorkspaces || loadingMoreWorkspaces,
        rowCount: orderedWorkspaces.length,
      })) {
        loadMoreWorkspaces();
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [
    sessionsScrollEl,
    sessionsOpen,
    hasMoreWorkspaces,
    loadingWorkspaces,
    loadingMoreWorkspaces,
    orderedWorkspaces.length,
    loadMoreWorkspaces,
    readSessionsMetrics,
  ]);

  // Chain-load: a page that does not fill the container (typically every cwd
  // collapsed) leaves nothing to scroll, so the scroll path can never fire.
  // After each settled page, measure once the layout has landed and pull the
  // next one — up to CHAIN_LOAD_LIMIT. Past the cap the manual fallback row
  // appears instead. Skipped entirely while the section is collapsed (no
  // layout, and no paging in the background).
  const evaluateChainLoad = useCallback(() => {
    const metrics = readSessionsMetrics();
    if (decideChainLoad({
      metrics,
      hasMore: hasMoreWorkspaces,
      // The same synchronous in-flight guard the scroll path uses: neither
      // path may issue a second request for a cursor already on the wire.
      loading: workspaceFetchInFlightRef.current,
      chainCount: chainLoadCountRef.current,
    })) {
      chainLoadCountRef.current += 1;
      setShowFallbackLoadMore(false);
      loadMoreWorkspaces();
      return;
    }
    setShowFallbackLoadMore(showChainFallback({ metrics, hasMore: hasMoreWorkspaces }));
  }, [hasMoreWorkspaces, loadMoreWorkspaces, readSessionsMetrics]);

  useEffect(() => {
    if (!sessionsOpen) return;
    if (loadingWorkspaces || loadingMoreWorkspaces) return;
    const id = requestAnimationFrame(evaluateChainLoad);
    return () => cancelAnimationFrame(id);
  }, [
    sessionsOpen,
    sessionsScrollEl,
    loadingWorkspaces,
    loadingMoreWorkspaces,
    orderedWorkspaces.length,
    hasMoreWorkspaces,
    // Collapsing every group can make the list unscrollable without a fetch;
    // re-measure then too so the fallback still surfaces.
    expandedCwds,
    evaluateChainLoad,
  ]);

  const handleFallbackLoadMore = useCallback(() => {
    // A manual click resets the chain counter, so the fallback can chain
    // again if the freshly appended page still does not fill the container.
    chainLoadCountRef.current = 0;
    loadMoreWorkspaces();
  }, [loadMoreWorkspaces]);

  // Refresh both the workspace metadata (lastUsed may shift) and the
  // current cwd's session page (name may change) after a rename.
  const handleSessionRenamed = useCallback((sessionId: string, name: string) => {
    setPerCwdSessions((prev) => {
      let changed = false;
      const next: Record<string, CwdSessionsState> = {};
      for (const [cwd, state] of Object.entries(prev)) {
        let rowChanged = false;
        const sessions = state.sessions.map((session) => {
          if (session.id !== sessionId || session.name === name) return session;
          changed = true;
          rowChanged = true;
          return { ...session, name };
        });
        next[cwd] = rowChanged ? { ...state, sessions } : state;
      }
      return changed ? next : prev;
    });
    onSessionRenamed?.(sessionId, name);
    // Refresh keeps the loaded depth (and the scroll position).
    refreshAll();
  }, [onSessionRenamed, refreshAll]);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    onSessionDeleted?.(sessionId);
    // Refresh keeps the loaded depth (and the scroll position).
    refreshAll();
  }, [onSessionDeleted, refreshAll]);

  return (
    <div className="session-sidebar" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "12px 10px 10px",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <PiAgentTitle />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {onNewSession && (() => {
              const canNew = true;
              return (
                <Tooltip content={t("New session")}>
                  <button
                    onClick={() => {
                      // Always create in the default cwd (~/.pi-work/workspace/pi-cwd-default).
                      void fetch("/api/default-cwd", { method: "POST" })
                        .then((res) => (res.ok ? res.json() : null))
                        .then((data: { cwd?: string } | null) => {
                          if (data?.cwd) onNewSession(data.cwd);
                        })
                        .catch(() => {});
                    }}
                    disabled={!canNew}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "rgba(37,99,235,0.08)",
                      border: "1px solid rgba(37,99,235,0.35)",
                      color: "var(--accent)",
                      cursor: canNew ? "pointer" : "not-allowed",
                      width: 32, height: 32,
                      borderRadius: 7,
                      padding: 0,
                      flexShrink: 0,
                      opacity: canNew ? 1 : 0.4,
                      transition: "opacity 0.12s, background 0.12s, border-color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      if (!canNew) return;
                      e.currentTarget.style.background = "rgba(37,99,235,0.18)";
                      e.currentTarget.style.borderColor = "rgba(37,99,235,0.55)";
                    }}
                    onMouseLeave={(e) => {
                      if (!canNew) return;
                      e.currentTarget.style.background = "rgba(37,99,235,0.08)";
                      e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <line x1="7" y1="2" x2="7" y2="12" />
                      <line x1="2" y1="7" x2="12" y2="7" />
                    </svg>
                  </button>
                </Tooltip>
              );
            })()}
            {onOpenSearch && (
              <Tooltip content={`${t("Command palette")} (⌘K)`}>
              <button
                onClick={onOpenSearch}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  width: 32, height: 32,
                  borderRadius: 7,
                  padding: 0,
                  flexShrink: 0,
                  transition: "color 0.12s, background 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.background = "var(--bg-selected)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
              </Tooltip>
            )}
          </div>
        </div>
        </div>

      {/* GrokBot companion — always-on living bot at the top of the sidebar.
          Click the bot (or the gear) to open the full lab modal. */}
      <GrokBotStage onOpenLab={() => setLabOpen(true)} />

      {/* Today's sessions — a flat, time-windowed view over the same rows
          the grouped Sessions section below renders. Intrinsically sized
          (grow: 0), capped by visible rows (not a viewport percentage) so a
          light day doesn't reserve blank space and a heavy day scrolls inside
          its cap. It is also the first section to give up height when the
          column runs short: minHeight keeps it from collapsing below one row
          while the Sessions list and Explorer keep their space. keepMounted
          keeps the list (and its already-loaded rows) alive across toggles so
          collapsing / expanding never replays the fetch. */}
      <SidebarSection
        title={t("Today's Sessions")}
        open={todayOpen}
        onToggle={() => setTodayOpen((v) => !v)}
        grow={0}
        maxHeight={sidebarListHeightPx(TODAY_VISIBLE_ROWS)}
        minHeight={sidebarListHeightPx(TODAY_MIN_ROWS)}
        keepMounted
        actions={
          <RefreshIconButton
            onClick={() => setTodayRefreshSignal((n) => n + 1)}
            label={t("Refresh today's sessions")}
          />
        }
      >
        <TodaySessionsList
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
          favoriteIds={favoriteIds}
          onToggleFavorite={onToggleFavorite}
          onSessionRenamed={handleSessionRenamed}
          onSessionDeleted={handleSessionDeleted}
          refreshKey={refreshKey}
          refreshSignal={todayRefreshSignal}
        />
      </SidebarSection>

      {/* Sessions section — cwd groups + their sessions. Collapsible via the
          shared SidebarSection (same flex-grow animation as Explorer). */}
      <SidebarSection
        title={t("Sessions")}
        open={sessionsOpen}
        onToggle={() => setSessionsOpen((v) => !v)}
        scrollRef={attachSessionsScroll}
        actions={
          <RefreshIconButton
            onClick={() => { void loadSessions(); }}
            label={t("Refresh sessions")}
          />
        }
      >
      <MultiCwdList
        workspaces={orderedWorkspaces}
        loadingWorkspaces={loadingWorkspaces}
        loadingMoreWorkspaces={loadingMoreWorkspaces}
        hasMoreWorkspaces={hasMoreWorkspaces}
        showFallbackLoadMore={showFallbackLoadMore}
        workspaceLoadError={workspaceLoadError}
        expandedCwds={expandedCwds}
        perCwdSessions={perCwdSessions}
        favoriteIds={favoriteIds}
        selectedSessionId={selectedSessionId}
        activeSession={selectedSession}

        onCwdHeaderRef={(cwd, el) => { cwdHeaderRefs.current[cwd] = el; }}
        onToggleExpand={handleToggleExpand}
        onSelectSession={onSelectSession}
        onLoadMoreWorkspaces={handleFallbackLoadMore}
        onLoadMoreCwdSessions={loadMoreCwdSessions}
        onOpenCwdSessions={openCwdSessions}
        onToggleFavorite={onToggleFavorite}
        onSessionRenamed={handleSessionRenamed}
        onSessionDeleted={handleSessionDeleted}
        onNewSession={onNewSession}
      />
      </SidebarSection>

      {/* File Explorer section — collapsible via the shared SidebarSection
          (flex-grow height animation). Future sidebar sections with the same
          collapse/expand behavior should reuse SidebarSection. */}
      {selectedCwdProp && (
        <SidebarSection
          title={t("Explorer")}
          open={explorerOpen}
          onToggle={() => setExplorerOpen((v) => !v)}
          actions={
            <>
              <Tooltip content={t("Collapse all")}>
              <button
                onClick={triggerCollapseAll}
                aria-label={t("Collapse all")}
                disabled={explorerExpandedCount === 0 && !explorerCollapseDone}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 26, height: 26, padding: 0, marginRight: 4,
                  background: explorerCollapseDone ? "rgba(74,222,128,0.18)" : "none",
                  border: "none",
                  color: explorerCollapseDone ? "#4ade80" : "var(--text-dim)",
                  opacity: explorerExpandedCount === 0 && !explorerCollapseDone ? 0.45 : 1,
                  cursor: explorerExpandedCount === 0 ? "default" : "pointer",
                  borderRadius: 5,
                  flexShrink: 0,
                  transition: "color 0.3s, background 0.3s, opacity 0.3s",
                }}
                onMouseEnter={(e) => { if (explorerExpandedCount === 0) return; e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { if (explorerExpandedCount === 0) return; e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
              >
                <MorphToggleIcon from={CHEVRONS_UP} to={CHECK} active={explorerCollapseDone} size={13} strokeWidth={2.5} />
              </button>
              </Tooltip>
              <RefreshIconButton
                onClick={triggerExplorerRefresh}
                label={t("Refresh explorer")}
              />
            </>
          }
        >
          <FileExplorer
            cwd={selectedCwdProp!}
            onOpenFile={onOpenFile ?? (() => {})}
            refreshKey={explorerKey}
            onAtMention={onAtMention}
            onFileMutated={triggerExplorerRefresh}
            onFileDeleted={onFileDeleted}
            collapseKey={explorerCollapseKey}
            onExpandedCountChange={setExplorerExpandedCount}
          />
        </SidebarSection>
      )}

      {onOpenSettings && (
        <ProfileBlock
          onOpenSettings={onOpenSettings}
          onOpenPrompts={onOpenPrompts}
          onOpenScheduler={onOpenScheduler}
          onOpenChannels={onOpenChannels}
          onOpenMcp={onOpenMcp}
          onLogout={onLogout}
          refreshKey={profileRefreshKey}
        />
      )}

      {labOpen && <GrokBotLab onClose={() => setLabOpen(false)} />}

      {cwdSessionsModalCwd && (
        <CwdSessionsModal
          cwd={cwdSessionsModalCwd}
          onClose={() => setCwdSessionsModalCwd(null)}
          onSelectSession={onSelectSession}
        />
      )}
    </div>
  );
}

