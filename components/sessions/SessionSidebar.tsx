"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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
import { CwdSessionsModal } from "./CwdSessionsModal";
import { SidebarSection } from "../ui/SidebarSection";
import { SESSION_ROW_HEIGHT_PX } from "@/lib/shared/sidebar-section";
import { useRunningSessions } from "@/hooks/runningSessionsStore";
import { appendSessionDateRange, localSessionDay, matchesSessionDate } from "@/lib/shared/session-date-filter";
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
  selectedCwd?: string | null;
  onOpenFile?: (filePath: string, fileName: string) => void;
  explorerRefreshKey?: number;
  onAtMention?: (filePath: string) => void;
  onOpenSearch?: () => void;
  onFileDeleted?: (filePath: string) => void;
  favoriteIds?: string[];
  onToggleFavorite?: (sessionId: string) => void;
  onOpenSettings?: () => void;
  onLogout?: () => void;
  profileRefreshKey?: number;
}

const SESSIONS_CONTENT_HEIGHT_PX = 1 * 34 + 6 * SESSION_ROW_HEIGHT_PX + 5 * 6 + 4 + 12;

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

export function SessionSidebar({ selectedSession, selectedSessionId, onSelectSession, initialSessionId, onInitialRestoreDone, refreshKey, onSessionDeleted, onSessionRenamed, onNewSession, selectedCwd: selectedCwdProp, onOpenFile, explorerRefreshKey, onAtMention, onOpenSearch, onFileDeleted, favoriteIds = [], onToggleFavorite, onOpenSettings, onLogout, profileRefreshKey }: Props) {
  const { byId: runningById } = useRunningSessions();
  const { t } = useI18n();
  const toast = useToast();
  const [todayOnly, setTodayOnly] = useState(false);
  const [today, setToday] = useState(() => localSessionDay(new Date()));
  const [todaySessions, setTodaySessions] = useState<SessionInfo[] | null>(null);
  const dateRange = todayOnly ? today : null;
  const cwdAbortRefs = useRef(new Map<string, AbortController>());
  const initializedCwdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const now = new Date();
      const next = localSessionDay(now);
      setToday((prev) => prev.from === next.from && prev.before === next.before ? prev : next);
      clearTimeout(timer);
      timer = setTimeout(update, Math.max(1, next.before - now.getTime()));
    };
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const [cwdSessionsModalCwd, setCwdSessionsModalCwd] = useState<string | null>(null);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [nextWorkspaceCursor, setNextWorkspaceCursor] = useState<string | null>(null);
  const [hasMoreWorkspaces, setHasMoreWorkspaces] = useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [loadingMoreWorkspaces, setLoadingMoreWorkspaces] = useState(false);
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null);
  const [perCwdSessions, setPerCwdSessions] = useState<Record<string, CwdSessionsState>>({});
  const [expandedCwd, setExpandedCwd] = useState<string | null>(null);
  const activeCwd = selectedSession?.cwd ?? selectedCwdProp ?? null;
  const cwdHeaderRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const sessionsScrollRef = useRef<HTMLDivElement | null>(null);
  const [sessionsScrollEl, setSessionsScrollEl] = useState<HTMLDivElement | null>(null);
  const attachSessionsScroll = useCallback((el: HTMLDivElement | null) => {
    sessionsScrollRef.current = el;
    setSessionsScrollEl(el);
  }, []);
  const [showFallbackLoadMore, setShowFallbackLoadMore] = useState(false);
  const chainLoadCountRef = useRef(0);
  const workspacesRef = useRef<Workspace[]>([]);
  const perCwdSessionsRef = useRef<Record<string, CwdSessionsState>>({});
  const workspaceFetchInFlightRef = useRef(false);

  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerCollapseKey, setExplorerCollapseKey] = useState(0);
  const [explorerExpandedCount, setExplorerExpandedCount] = useState(0);
  const [explorerCollapseDone, setExplorerCollapseDone] = useState(false);
  const explorerCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceAbortRef = useRef<AbortController | null>(null);

  const triggerExplorerRefresh = useCallback(() => {
    setExplorerKey((k) => k + 1);
    if (selectedCwdProp) notifyMutated(selectedCwdProp);
  }, [selectedCwdProp]);

  const triggerCollapseAll = useCallback(() => {
    setExplorerCollapseKey((k) => k + 1);
    setExplorerCollapseDone(true);
    if (explorerCollapseTimerRef.current) clearTimeout(explorerCollapseTimerRef.current);
    explorerCollapseTimerRef.current = setTimeout(() => setExplorerCollapseDone(false), 700);
  }, []);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);
  useEffect(() => {
    perCwdSessionsRef.current = perCwdSessions;
  }, [perCwdSessions]);

  useEffect(() => {
    if (!activeCwd) return;
    setExpandedCwd((prev) => (prev === activeCwd ? prev : activeCwd));
  }, [activeCwd]);

  const fetchWorkspaces = useCallback(async (
    cursor: string | null,
    mode: "reset" | "append",
    limitOverride?: number,
  ) => {
    workspaceAbortRef.current?.abort();
    const controller = new AbortController();
    workspaceAbortRef.current = controller;
    workspaceFetchInFlightRef.current = true;
    if (mode === "reset") setLoadingWorkspaces(true);
    else setLoadingMoreWorkspaces(true);
    setWorkspaceLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limitOverride ?? WORKSPACE_PAGE_SIZE));
      if (mode === "reset") appendSessionDateRange(params, today, "today");
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/workspaces?${params.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as WorkspacesResponse;
      if (controller.signal.aborted) return;
      if (data.todaySessions) setTodaySessions(data.todaySessions);
      if (mode === "reset") {
        setWorkspaces(data.workspaces);
      } else {
        setWorkspaces((prev) => mergePage(prev, data.workspaces, (w) => w.cwd));
      }
      setNextWorkspaceCursor(data.nextCursor);
      setHasMoreWorkspaces(data.nextCursor !== null);
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
  }, [toast, today]);

  const fetchCwdSessions = useCallback(async (
    cwd: string,
    cursor: string | null,
    mode: "reset" | "append",
    limitOverride?: number,
  ) => {
    cwdAbortRefs.current.get(cwd)?.abort();
    const controller = new AbortController();
    cwdAbortRefs.current.set(cwd, controller);
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
      const res = await fetch(`/api/sessions?${params.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { sessions: SessionInfo[]; nextCursor: string | null };
      if (controller.signal.aborted) return;
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
      if (controller.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      setPerCwdSessions((prev) => {
        const existing = prev[cwd];
        if (!existing) return prev;
        return {
          ...prev,
          [cwd]: { ...existing, loading: false, loadingMore: false, loadError: msg },
        };
      });
    } finally {
      if (cwdAbortRefs.current.get(cwd) === controller) cwdAbortRefs.current.delete(cwd);
    }
  }, []);

  useEffect(() => {
    const controllers = cwdAbortRefs.current;
    return () => {
      workspaceAbortRef.current?.abort();
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  useEffect(() => {
    const cwd = selectedSession?.cwd;
    if (!cwd) return;

    setExpandedCwd((prev) => (prev === cwd ? prev : cwd));
    void fetchCwdSessions(cwd, null, "reset");

    const frame = requestAnimationFrame(() => {
      cwdHeaderRefs.current[cwd]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedSession?.id, selectedSession?.cwd, fetchCwdSessions]);

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

  const loadSessions = useCallback(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    refreshAll();
  }, [refreshKey, refreshAll]);

  useEffect(() => {
    for (const ws of workspaces) {
      if (initializedCwdsRef.current.has(ws.cwd)) continue;
      if (expandedCwd !== ws.cwd) continue;
      const state = perCwdSessions[ws.cwd];
      if (state && (state.sessions.length > 0 || state.loading)) continue;
      initializedCwdsRef.current.add(ws.cwd);
      void fetchCwdSessions(ws.cwd, null, "reset");
    }
  }, [workspaces, expandedCwd, perCwdSessions, fetchCwdSessions]);

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

  useEffect(() => {
    if (loadingWorkspaces) return;

    if (initialSessionId && !restoredRef.current) {
      restoredRef.current = true;
      void (async () => {
        try {
          const res = await fetch(`/api/sessions/${encodeURIComponent(initialSessionId)}/info`);
          if (res.ok) {
            const data = (await res.json()) as { session: SessionInfo };
            onSelectSession(data.session, true);
            return;
          }
        } catch {}
        onInitialRestoreDone?.();
      })();
    }
  }, [loadingWorkspaces, initialSessionId, onSelectSession, onInitialRestoreDone]);

  const activeWorkspace = useMemo(() => (selectedCwdProp
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
    : null), [selectedCwdProp, workspaces, selectedSession]);
  const orderedWorkspaces = useMemo(
    () => (activeWorkspace
      ? [activeWorkspace, ...workspaces.filter((workspace) => workspace.cwd !== activeWorkspace.cwd)]
      : workspaces),
    [activeWorkspace, workspaces],
  );

  const todayView = useMemo(() => {
    const groups: Record<string, CwdSessionsState> = {};
    const byCwd = new Map<string, Workspace>();
    let count = 0;
    const sessions = (todaySessions ?? [])
      .filter((session) => matchesSessionDate(session.modified, today))
      .sort((a, b) => b.modified.localeCompare(a.modified));
    for (const cached of sessions) {
      const session = runningById.has(cached.id)
        ? { ...cached, running: runningById.get(cached.id)! }
        : cached;
      const cwd = session.cwd;
      count += 1;
      const workspace = byCwd.get(cwd);
      if (workspace) {
        workspace.totalSessions += 1;
        workspace.runningCount += session.running ? 1 : 0;
      } else {
        byCwd.set(cwd, {
          cwd, lastUsed: session.modified, totalSessions: 1,
          runningCount: session.running ? 1 : 0,
          firstMessage: session.firstMessage, latestSessionName: session.name,
        });
        groups[cwd] = {
          sessions: [], cursor: null, hasMore: false,
          loading: false, loadingMore: false, loadError: null,
        };
      }
      groups[cwd].sessions.push(session);
    }
    const rows = [...byCwd.values()].sort((a, b) => {
      if (a.cwd === selectedCwdProp) return -1;
      if (b.cwd === selectedCwdProp) return 1;
      return b.lastUsed.localeCompare(a.lastUsed) || a.cwd.localeCompare(b.cwd);
    });
    return { workspaces: rows, groups, count };
  }, [todaySessions, today, runningById, selectedCwdProp]);

  const toggleExpandCwd = useCallback((cwd: string) => {
    setExpandedCwd((prev) => (prev === cwd ? null : cwd));
  }, []);

  const handleToggleExpand = useCallback((cwd: string) => {
    toggleExpandCwd(cwd);
  }, [toggleExpandCwd]);

  const loadMoreCwdSessions = useCallback((cwd: string) => {
    const state = perCwdSessions[cwd];
    if (!state?.cursor || state.loadingMore) return;
    void fetchCwdSessions(cwd, state.cursor, "append");
  }, [perCwdSessions, fetchCwdSessions]);

  const openCwdSessions = useCallback((cwd: string) => {
    setCwdSessionsModalCwd(cwd);
  }, []);

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

  const pagingInteractionRef = useRef(true);
  useEffect(() => {
    const el = sessionsScrollEl;
    if (!el || !sessionsOpen || todayOnly) return;
    const onInteract = () => { pagingInteractionRef.current = true; };
    const onScroll = () => {
      if (!pagingInteractionRef.current) return;
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
    const interactions = ["wheel", "touchmove", "pointerdown", "keydown"] as const;
    for (const event of interactions) el.addEventListener(event, onInteract, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      for (const event of interactions) el.removeEventListener(event, onInteract);
    };
  }, [
    sessionsScrollEl,
    sessionsOpen,
    todayOnly,
    hasMoreWorkspaces,
    loadingWorkspaces,
    loadingMoreWorkspaces,
    orderedWorkspaces.length,
    loadMoreWorkspaces,
    readSessionsMetrics,
  ]);

  const evaluateChainLoad = useCallback(() => {
    const metrics = readSessionsMetrics();
    if (decideChainLoad({
      metrics,
      hasMore: hasMoreWorkspaces,
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

  const previousViewRef = useRef(todayOnly);
  useEffect(() => {
    const switchedView = previousViewRef.current !== todayOnly;
    previousViewRef.current = todayOnly;
    if (todayOnly || switchedView || !sessionsOpen) return;
    if (loadingWorkspaces || loadingMoreWorkspaces) return;
    const id = requestAnimationFrame(evaluateChainLoad);
    return () => cancelAnimationFrame(id);
  }, [
    todayOnly,
    sessionsOpen,
    sessionsScrollEl,
    loadingWorkspaces,
    loadingMoreWorkspaces,
    orderedWorkspaces.length,
    hasMoreWorkspaces,
    expandedCwd,
    evaluateChainLoad,
  ]);

  const handleFallbackLoadMore = useCallback(() => {
    chainLoadCountRef.current = 0;
    loadMoreWorkspaces();
  }, [loadMoreWorkspaces]);

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
    refreshAll();
  }, [onSessionRenamed, refreshAll]);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    onSessionDeleted?.(sessionId);
    refreshAll();
  }, [onSessionDeleted, refreshAll]);

  return (
    <div className="session-sidebar" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
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

      <SidebarSection
        title={todayOnly ? `${t("Sessions")} (${todayView.count})` : t("Sessions")}
        open={sessionsOpen}
        onToggle={() => setSessionsOpen((v) => !v)}
        scrollRef={attachSessionsScroll}
        contentHeight={SESSIONS_CONTENT_HEIGHT_PX}
        actions={
          <>
          <Tooltip content={t("Only today's sessions")}>
            <button
              type="button"
              aria-label={t("Only today's sessions")}
              aria-pressed={todayOnly}
              disabled={todaySessions === null}
              onClick={() => {
                pagingInteractionRef.current = false;
                setTodayOnly((value) => !value);
              }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, padding: 0, marginRight: 4,
                border: "none", borderRadius: 5,
                cursor: todaySessions === null ? "default" : "pointer",
                opacity: todaySessions === null ? 0.45 : 1,
                color: todayOnly ? "var(--accent)" : "var(--text-dim)",
                background: todayOnly ? "var(--bg-selected)" : "none",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M16 3v4M8 3v4M3 11h18" />
                <circle cx="12" cy="16" r="1" fill="currentColor" />
              </svg>
            </button>
          </Tooltip>
          <RefreshIconButton
            onClick={() => { void loadSessions(); }}
            label={t("Refresh sessions")}
          />
          </>
        }
      >
      <MultiCwdList
        workspaces={todayOnly ? todayView.workspaces : orderedWorkspaces}
        emptyMessage={todayOnly ? t("No sessions today") : undefined}
        loadingWorkspaces={!todayOnly && loadingWorkspaces}
        loadingMoreWorkspaces={!todayOnly && loadingMoreWorkspaces}
        hasMoreWorkspaces={!todayOnly && hasMoreWorkspaces}
        showFallbackLoadMore={!todayOnly && showFallbackLoadMore}
        workspaceLoadError={workspaceLoadError}
        expandedCwd={expandedCwd}
        perCwdSessions={todayOnly ? todayView.groups : perCwdSessions}
        favoriteIds={favoriteIds}
        selectedSessionId={selectedSessionId}
        activeSession={selectedSession && matchesSessionDate(selectedSession.modified, dateRange) ? selectedSession : null}

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
          onLogout={onLogout}
          refreshKey={profileRefreshKey}
        />
      )}

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
