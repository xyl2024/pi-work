"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { SessionInfo, Workspace } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { SessionItem } from "./SessionItem";
import { Tooltip } from "./Tooltip";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { CwdIcon } from "./FileIcons";
import { useAllPendingAskUserQuestions } from "@/hooks/askUserQuestionsStore";

/**
 * Per-cwd session loader state. Held in a Map keyed by cwd so each group
 * can paginate independently without disturbing the others.
 */
export interface CwdSessionsState {
  sessions: SessionInfo[];
  cursor: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  loadError: string | null;
}

interface MultiCwdListProps {
  /** Ordered list — active cwd first, then by lastUsed desc */
  workspaces: Workspace[];
  loadingWorkspaces: boolean;
  loadingMoreWorkspaces: boolean;
  hasMoreWorkspaces: boolean;
  workspaceLoadError: string | null;
  /** cwd → expanded (true) / collapsed (false). Caller owns persistence. */
  expandedCwds: Record<string, boolean>;
  /** cwd → session loader state */
  perCwdSessions: Record<string, CwdSessionsState>;
  favoriteIds: string[];
  selectedSessionId: string | null;
  /** Full active session metadata, used when the selected row is outside the loaded page. */
  activeSession?: SessionInfo | null;

  /** Tell the parent about cwd header refs so it can scrollIntoView on activate. */
  onCwdHeaderRef: (cwd: string, el: HTMLDivElement | null) => void;

  onToggleExpand: (cwd: string) => void;
  onSelectSession: (session: SessionInfo) => void;
  onLoadMoreWorkspaces: () => void;
  onLoadMoreCwdSessions: (cwd: string) => void;
  onToggleFavorite?: (sessionId: string) => void;
  onSessionRenamed: () => void;
  onSessionDeleted: (sessionId: string) => void;
  /** Called with the workspace cwd when the per-cwd "+" button is clicked.
   *  Wraps the parent-side new-session handler so the caller can decide
   *  which cwd wins regardless of the picker's active selection. */
  onNewSession?: (cwd: string) => void;
}

/**
 * Multi-cwd workspace list. Renders one CwdGroup per workspace, with the
 * active cwd pinned to the top. Each group is independently collapsible
 * (state owned by the parent — this component just renders + dispatches).
 */
export function MultiCwdList({
  workspaces,
  loadingWorkspaces,
  loadingMoreWorkspaces,
  hasMoreWorkspaces,
  workspaceLoadError,
  expandedCwds,
  perCwdSessions,
  favoriteIds,
  selectedSessionId,
  activeSession,
  onCwdHeaderRef,
  onToggleExpand,
  onSelectSession,
  onLoadMoreWorkspaces,
  onLoadMoreCwdSessions,
  onToggleFavorite,
  onSessionRenamed,
  onSessionDeleted,
  onNewSession,
}: MultiCwdListProps) {
  const { t } = useI18n();

  // Set of sessionIds that currently have an unanswered `ask_user_questions`
  // request. Read from the module-scoped store so we re-render whenever a
  // question appears or resolves in any session, not just the visible one.
  const pendingQuestions = useAllPendingAskUserQuestions();
  const pendingQuestionSessionIds = new Set(pendingQuestions.map((p) => p.sessionId));

  return (
    <div data-scroll-side style={{ flex: 1, overflowY: "auto", padding: "4px 8px 8px", minHeight: 80, display: "flex", flexDirection: "column", gap: 8 }}>
      {loadingWorkspaces && workspaces.length === 0 && (
        <div style={{ padding: "16px 8px 6px", color: "var(--text-muted)", fontSize: 12 }}>
          {t("Loading projects...")}
        </div>
      )}
      {workspaceLoadError && !loadingWorkspaces && workspaces.length === 0 && (
        <div style={{ padding: "16px 8px 6px", color: "#f87171", fontSize: 12 }}>
          {workspaceLoadError}
        </div>
      )}
      {!loadingWorkspaces && !workspaceLoadError && workspaces.length === 0 && (
        <div style={{ padding: "16px 8px 6px", color: "var(--text-muted)", fontSize: 12 }}>
          {t("No projects yet")}
        </div>
      )}

      {workspaces.map((ws) => {
        // Default: every cwd is expanded on first load. localStorage retains
        // any prior collapsed state — first-writer-wins per cwd.
        const expanded = expandedCwds[ws.cwd] ?? true;
        const group = perCwdSessions[ws.cwd];
        // 选中的会话若不在 group 已加载页面里，额外插到第 3 项之后，
        // 让用户既能看到原本的 3 条最近会话，又能直接定位到选中项。
        // 已加载时 group 原样显示 —— SessionItem 自己根据 selectedSessionId
        // 渲染选中态，不再重排。
        const activeSessionInCwd = activeSession?.cwd === ws.cwd ? activeSession : null;
        const activeNotInGroup = activeSessionInCwd && !group?.sessions.some((session) => session.id === activeSessionInCwd.id);
        const PAGE_SIZE = 3; // 与 SessionSidebar.SESSION_PAGE_SIZE_GROUPED 保持一致
        const displayGroup = activeNotInGroup
          ? {
              sessions: [
                ...(group?.sessions ?? []).slice(0, PAGE_SIZE),
                activeSessionInCwd,
                ...(group?.sessions ?? []).slice(PAGE_SIZE),
              ],
              cursor: group?.cursor ?? null,
              hasMore: group?.hasMore ?? false,
              loading: group?.loading ?? false,
              loadingMore: group?.loadingMore ?? false,
              loadError: group?.loadError ?? null,
            }
          : group;

        return (
          <CwdGroup
            key={ws.cwd}
            workspace={ws}
            expanded={expanded}
            group={displayGroup}
            favoriteIds={favoriteIds}
            selectedSessionId={selectedSessionId}
            pendingQuestionSessionIds={pendingQuestionSessionIds}
            onHeaderRef={(el) => onCwdHeaderRef(ws.cwd, el)}
            onToggleExpand={() => onToggleExpand(ws.cwd)}
            onSelectSession={onSelectSession}
            onLoadMoreSessions={() => onLoadMoreCwdSessions(ws.cwd)}
            onToggleFavorite={onToggleFavorite}
            onSessionRenamed={() => onSessionRenamed()}
            onSessionDeleted={onSessionDeleted}
            onNewSession={onNewSession}
          />
        );
      })}

      {hasMoreWorkspaces && (
        <button
          onClick={onLoadMoreWorkspaces}
          disabled={loadingMoreWorkspaces}
          style={{
            alignSelf: "center",
            padding: "5px 14px",
            background: "var(--bg-hover)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text-muted)",
            cursor: loadingMoreWorkspaces ? "default" : "pointer",
            fontSize: 11,
            opacity: loadingMoreWorkspaces ? 0.6 : 1,
            marginTop: 2,
          }}
        >
          {loadingMoreWorkspaces ? t("Loading more...") : t("Load more projects")}
        </button>
      )}
      {!hasMoreWorkspaces && workspaces.length > 0 && (
        <div style={{ padding: "4px 8px 0", color: "var(--text-dim)", fontSize: 10, textAlign: "center" }}>
          {t("End of projects")}
        </div>
      )}
    </div>
  );
}

interface CwdGroupProps {
  workspace: Workspace;
  expanded: boolean;
  group: CwdSessionsState | undefined;
  favoriteIds: string[];
  selectedSessionId: string | null;
  /** Set of sessionIds with an unanswered `ask_user_questions` request.
   *  Owned by the parent so the whole sidebar re-renders in sync when the
   *  store changes, not just the group that contains the affected session. */
  pendingQuestionSessionIds: Set<string>;

  onHeaderRef: (el: HTMLDivElement | null) => void;
  onToggleExpand: () => void;
  onSelectSession: (session: SessionInfo) => void;
  onLoadMoreSessions: () => void;
  onToggleFavorite?: (sessionId: string) => void;
  onSessionRenamed: () => void;
  onSessionDeleted: (sessionId: string) => void;
  onNewSession?: (cwd: string) => void;
}

function CwdGroup({
  workspace,
  expanded,
  group,
  favoriteIds,
  selectedSessionId,
  pendingQuestionSessionIds,
  onHeaderRef,
  onToggleExpand,
  onSelectSession,
  onLoadMoreSessions,
  onToggleFavorite,
  onSessionRenamed,
  onSessionDeleted,
  onNewSession,
}: CwdGroupProps) {
  const { t } = useI18n();
  const headerRef = useRef<HTMLDivElement | null>(null);

  // Forward the header DOM node to the parent so it can scrollIntoView when
  // the active cwd changes (e.g. via picker → list sync).
  useEffect(() => {
    onHeaderRef(headerRef.current);
    return () => onHeaderRef(null);
  }, [onHeaderRef]);

  // Body height animation for expand/collapse. The body DOM outlives the
  // collapsed state so the exit animation can squeeze it to zero, then it
  // unmounts (session data lives in the parent's perCwdSessions cache, so
  // re-expanding remounts instantly). Unlike useCollapseHeight, the measured
  // element is unmounted between collapses, so the ResizeObserver rebinds on
  // every `rendered` flip instead of once at mount.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [allowAnim, setAllowAnim] = useState(false);
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  const [rendered, setRendered] = useState(expanded);
  const [collapsed, setCollapsed] = useState(!expanded);

  useEffect(() => {
    const id = requestAnimationFrame(() => setAllowAnim(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Measure the rendered body; follow content growth (lazy-loaded sessions
  // arriving mid-expand) via ResizeObserver.
  useEffect(() => {
    if (!rendered) return;
    const el = bodyRef.current;
    if (!el) return;
    const update = () =>
      setBodyHeight((prev) => (prev === el.scrollHeight ? prev : el.scrollHeight));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rendered]);

  // Expand: remount the body, keep it squeezed until measured, then release
  // so the height transition runs 0 → actual.
  useEffect(() => {
    if (expanded) setRendered(true);
  }, [expanded]);

  useEffect(() => {
    if (expanded && rendered && bodyHeight != null) setCollapsed(false);
  }, [expanded, rendered, bodyHeight]);

  // Collapse: squeeze to zero, then unmount after the animation window.
  // The timeout also covers the empty-body case where no transition fires.
  useEffect(() => {
    if (expanded) return;
    setCollapsed(true);
    const timer = window.setTimeout(() => setRendered(false), 220);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  const sessions = group?.sessions ?? [];
  // API 已经返回 modified desc，这里重新排一次作为防御性兜底。
  const orderedSessions = sessions.slice().sort((a, b) => b.modified.localeCompare(a.modified));

  // The dynamic tail of the list: whichever session renders last right now.
  // It moves as more sessions load, which is exactly what "load more" must
  // attach to.
  const lastSessionId = orderedSessions.length > 0 ? orderedSessions[orderedSessions.length - 1].id : null;
  const canLoadMore = !!group?.hasMore;

  // Shared row renderer — the group's last row gets wrapped with the
  // hover-revealed "Load more sessions" affordance (see LastSessionLoadMore).
  // The React key travels through `key` so both callers stay keyed.
  const sessionRow = (s: SessionInfo, key: string) => (
    <SessionItem
      key={key}
      session={s}
      isSelected={s.id === selectedSessionId}
      onClick={() => onSelectSession(s)}
      onRenamed={onSessionRenamed}
      onDeleted={(id) => onSessionDeleted(id)}
      isFavorited={favoriteIds.includes(s.id)}
      onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(s.id) : undefined}
      hasPendingQuestion={pendingQuestionSessionIds.has(s.id)}
    />
  );

  const sessionRowWithLoadMore = (s: SessionInfo, key: string) =>
    s.id === lastSessionId && canLoadMore ? (
      <LastSessionLoadMore
        key={key}
        loadingMore={!!group?.loadingMore}
        onLoadMore={onLoadMoreSessions}
      >
        {sessionRow(s, key)}
      </LastSessionLoadMore>
    ) : sessionRow(s, key);

  // "..." menu state — mirrors SessionItem's pattern. The trigger button
  // (shown only on row hover) opens a portal'd menu panel on click.
  const [rowHovered, setRowHovered] = useState(false);
  const [triggerHovered, setTriggerHovered] = useState(false);
  const [loadMenuOpen, setLoadMenuOpen] = useState(false);
  const [loadMenuPos, setLoadMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [loadMenuVisible, setLoadMenuVisible] = useState(false);
  const loadMenuRef = useRef<HTMLDivElement | null>(null);
  const loadMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const showLoadMoreTrigger = group?.hasMore && (rowHovered || triggerHovered || loadMenuOpen);

  const cancelMenuClose = useCallback(() => {
    // no-op; kept for symmetry with SessionItem
  }, []);

  const openLoadMenu = useCallback(() => {
    cancelMenuClose();
    if (!loadMenuTriggerRef.current) return;
    const rect = loadMenuTriggerRef.current.getBoundingClientRect();
    setLoadMenuPos({ top: rect.top, left: rect.right + 6 });
    setLoadMenuOpen(true);
  }, [cancelMenuClose]);

  // Animate the menu in (matches SessionItem's rAF pattern).
  useEffect(() => {
    if (!loadMenuOpen) {
      setLoadMenuVisible(false);
      return;
    }
    const id = requestAnimationFrame(() => setLoadMenuVisible(true));
    return () => cancelAnimationFrame(id);
  }, [loadMenuOpen]);

  // Close the menu on outside mousedown / ESC / scroll / resize.
  useEffect(() => {
    if (!loadMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (loadMenuRef.current?.contains(target)) return;
      if (loadMenuTriggerRef.current?.contains(target)) return;
      cancelMenuClose();
      setLoadMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelMenuClose();
        setLoadMenuOpen(false);
      }
    };
    const onScroll = () => {
      cancelMenuClose();
      setLoadMenuOpen(false);
    };
    const onResize = () => {
      cancelMenuClose();
      setLoadMenuOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [loadMenuOpen, cancelMenuClose]);

  return (
    // No gap between header and body here: the 4px spacing lives as
    // paddingTop on the body's inner content (below) so it animates with
    // the height. A flex gap here would sit OUTSIDE the height-animated,
    // overflow-hidden container — collapsing to height 0 would still leave
    // the 4px gap behind, and when the body unmounts 220ms later the gap
    // would vanish in a non-animated 4px snap.
    <div
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Cwd header — plain row, no hover/active visual. Click anywhere on
          the row toggles expand/collapse. The right-side "…" trigger opens
          a portal menu (Load more sessions) modelled on SessionItem's menu
          pattern. */}
      <div
        ref={headerRef}
        onClick={onToggleExpand}
        onMouseEnter={() => setRowHovered(true)}
        onMouseLeave={() => setRowHovered(false)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleExpand(); } }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 6px 6px 4px",
          background: "transparent",
          borderRadius: 7,
          cursor: "pointer",
        }}
      >
        {/* Cwd / project icon — filled, theme-tinted via currentColor.
            Pinned to var(--accent) so it stands out from the muted chrome
            (basename stays --text-muted) and gives each cwd row a coloured
            anchor. The icon already depicts an "opened" folder, so it does
            not flip with `expanded`; the fold/unfold chevron next to the
            basename (see below) is the canonical expand/collapse affordance. */}
        <span
          aria-hidden
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 16, height: 22,
            color: "var(--accent)",
            flexShrink: 0,
          }}
        >
          <CwdIcon size={14} />
        </span>

        {/* Path — basename, then the fold/unfold chevron immediately after
            (not right-aligned), then the running dot. */}
        <span
          style={{
            flex: 1, minWidth: 0,
            display: "flex", alignItems: "center", gap: 4,
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          <span style={{
            flex: "0 1 auto", minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {basenameOf(workspace.cwd)}
          </span>

          {/* Fold/unfold chevron — sits right after the basename. Points
              down when expanded, right when collapsed (rotates -90deg). */}
          <span
            aria-hidden
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
              color: "var(--text-dim)",
              transition: "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
              transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
            }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="2 4 5 7 8 4" />
            </svg>
          </span>
        </span>

        {/* "+" trigger — shown only on row hover (matches the existing "…"
            trigger pattern). Click creates a new session in this cwd
            without disturbing the picker's active selection. stopPropagation
            keeps the parent header click from also toggling expand. */}
        {onNewSession && rowHovered && (
          <Tooltip content={t("New session in this project")}>
            <button
              aria-label={t("New session in this project")}
              onClick={(e) => {
                e.stopPropagation();
                onNewSession(workspace.cwd);
              }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 22, height: 22, padding: 0, flexShrink: 0,
                background: "transparent",
                border: "1px solid transparent",
                borderRadius: 6,
                color: "var(--text-muted)",
                cursor: "pointer",
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="7" y1="2" x2="7" y2="12" />
                <line x1="2" y1="7" x2="12" y2="7" />
              </svg>
            </button>
          </Tooltip>
        )}

        {/* "…" trigger — shown on row hover or while menu is open. Mirrors
            SessionItem's row-hover trigger pattern. Click opens the menu. */}
        {showLoadMoreTrigger && (
          <button
            ref={loadMenuTriggerRef}
            aria-label={t("More actions")}
            onClick={(e) => {
              e.stopPropagation();
              if (loadMenuOpen) {
                setLoadMenuOpen(false);
              } else {
                openLoadMenu();
              }
            }}
            onMouseEnter={() => setTriggerHovered(true)}
            onMouseLeave={() => setTriggerHovered(false)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22, padding: 0,
              background: loadMenuOpen ? "var(--bg-selected)" : "transparent",
              border: loadMenuOpen ? "1px solid color-mix(in srgb, var(--accent) 35%, transparent)" : "1px solid transparent",
              borderRadius: 6,
              color: loadMenuOpen ? "var(--accent)" : "var(--text-muted)",
              cursor: "pointer", flexShrink: 0,
              transition: "background 0.12s, color 0.12s, border-color 0.12s",
            }}
            onMouseOver={(e) => {
              if (loadMenuOpen) return;
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseOut={(e) => {
              if (loadMenuOpen) return;
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ opacity: loadMenuOpen ? 1 : 0.85 }}>
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
        )}

        {/* Menu panel via createPortal — same look as SessionItem's row menu. */}
        {loadMenuOpen && loadMenuPos && createPortal(
          <div
            ref={loadMenuRef}
            role="menu"
            style={{
              position: "fixed",
              top: loadMenuPos.top,
              left: loadMenuPos.left,
              zIndex: 9999,
              minWidth: 168,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 6px 20px rgba(0,0,0,0.32)",
              padding: 4,
              display: "flex",
              flexDirection: "column",
              gap: 1,
              fontSize: 12,
              color: "var(--text)",
              transformOrigin: "left top",
              opacity: loadMenuVisible ? 1 : 0,
              transform: loadMenuVisible
                ? "translateY(0) scale(1)"
                : "translateY(-6px) scale(0.96)",
              transition:
                "opacity 140ms ease-out, transform 160ms cubic-bezier(0.22, 1, 0.36, 1)",
              pointerEvents: loadMenuVisible ? "auto" : "none",
            }}
          >
            {group?.hasMore && (
              <CwdMenuRow
                index={0}
                icon={<LoadMoreIcon />}
                label={group.loadingMore ? t("Loading more...") : t("Load more sessions")}
                disabled={group.loadingMore}
                onClick={() => {
                  setLoadMenuOpen(false);
                  onLoadMoreSessions();
                }}
              />
            )}
          </div>,
          document.body,
        )}
      </div>

      {/* Body: pinned sessions + recent sessions. The DOM outlives the
          collapsed state so the exit animation can squeeze it to zero, then
          it unmounts after the animation settles. */}
      {rendered && (
        <div
          style={{
            height: collapsed ? 0 : bodyHeight ?? undefined,
            overflow: "hidden",
            // Opacity trails the height so text doesn't look squashed mid-
            // animation (same trick as CollapsiblePanel).
            opacity: collapsed ? 0 : 1,
            transition:
              allowAnim && bodyHeight != null
                ? "height 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 110ms ease 55ms"
                : "none",
          }}
        >
          <div ref={bodyRef} style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 6, paddingTop: 4 }}>
          {group?.loading && sessions.length === 0 && (
            <div style={{ padding: "10px 6px 4px", color: "var(--text-muted)", fontSize: 11 }}>
              {t("Loading sessions...")}
            </div>
          )}
          {group?.loadError && !group.loading && sessions.length === 0 && (
            <div style={{ padding: "10px 6px 4px", color: "#f87171", fontSize: 11 }}>
              {group.loadError}
            </div>
          )}
          {!group?.loading && sessions.length === 0 && !group?.loadError && (
            <div style={{ padding: "10px 6px 4px", color: "var(--text-dim)", fontSize: 11 }}>
              {t("No sessions found")}
            </div>
          )}

          {orderedSessions.map((s) =>
            sessionRowWithLoadMore(s, s.id)
          )}
          </div>
        </div>
      )}
    </div>
  );
}

function basenameOf(cwd: string): string {
  // Pick the separator that actually appears in the path. Windows uses
  // backslashes; POSIX uses slashes. If both are present (unusual but
  // legal on Windows after POSIX tools), prefer "/" so mixed paths render
  // sensibly. filter(Boolean) drops the empty leading segment produced by
  // absolute paths.
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  const parts = cwd.split(sep).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function CwdMenuRow({
  icon,
  label,
  onClick,
  disabled,
  index = 0,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  index?: number;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); if (!disabled) onClick(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 9px",
        borderRadius: 5,
        cursor: disabled ? "default" : "pointer",
        userSelect: "none",
        color: disabled ? "var(--text-dim)" : "var(--text)",
        background: hover && !disabled ? "var(--bg-hover)" : "transparent",
        animation: "pi-menu-row-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both",
        animationDelay: `${40 + index * 28}ms`,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, color: disabled ? "var(--text-dim)" : "var(--text-muted)", opacity: 0.85 }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
    </div>
  );
}

/**
 * Wraps the last session row of a cwd group. While the pointer is over the
 * row (or the revealed row below it), a "Load more sessions" row smoothly
 * expands beneath it via CollapsiblePanel. The wrapped row is whatever the
 * caller passes in, so the trigger follows the list's dynamic tail as more
 * sessions load.
 */
function LastSessionLoadMore({
  children,
  loadingMore,
  onLoadMore,
}: {
  children: React.ReactNode;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    // No gap on this flex column either: the 6px spacing sits as paddingTop
    // INSIDE the CollapsiblePanel row (which is overflow:hidden), so it
    // expands/collapses with the grid height. A flex gap here would sit
    // outside the animated grid and snap away when the panel unmounts
    // after the collapse animation — the same non-animated jump as the
    // cwd group header.
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}
    >
      {children}
      <CollapsiblePanel open={hovered}>
        <div style={{ paddingTop: 6 }}>
          <LoadMoreRow loadingMore={loadingMore} onClick={onLoadMore} />
        </div>
      </CollapsiblePanel>
    </div>
  );
}

/**
 * The revealed "load more" row — same height and indent as a session row so
 * it reads as a sibling of the items it sits under.
 */
function LoadMoreRow({ loadingMore, onClick }: { loadingMore: boolean; onClick: () => void }) {
  const { t } = useI18n();
  const [hover, setHover] = useState(false);
  const disabled = loadingMore;
  return (
    <div
      role="button"
      tabIndex={0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => { if (!disabled) onClick(); }}
      onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}
      style={{
        height: 28,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 6,
        paddingLeft: 18, // matches SessionItem's TEXT_INDENT_PX
        paddingRight: 8,
        borderRadius: 8,
        cursor: disabled ? "default" : "pointer",
        userSelect: "none",
        color: disabled ? "var(--text-dim)" : "var(--text-muted)",
        background: hover && !disabled ? "var(--bg-hover)" : "transparent",
        fontSize: 12,
        transition: "background 0.1s",
      }}
    >
      <LoadMoreIcon />
      <span>{disabled ? t("Loading more...") : t("Load more sessions")}</span>
    </div>
  );
}

function LoadMoreIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}