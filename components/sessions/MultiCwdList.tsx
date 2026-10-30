"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { SessionInfo, Workspace } from "@/lib/shared/types";
import { useI18n } from "@/hooks/useI18n";
import { SessionItem } from "./SessionItem";
import { Tooltip } from "../ui/Tooltip";
import { CollapsiblePanel } from "../ui/CollapsiblePanel";
import { CwdProjectIcon } from "../files/CwdProjectIcon";
import { CwdIconPicker } from "../files/CwdIconPicker";
import { CwdToolsPicker } from "./CwdToolsPicker";
import { CwdAliasDialog } from "./CwdAliasDialog";
import { useCwdIcon, setCwdIcon, initCwdIcons } from "@/hooks/cwdIconStore";
import { useCwdAlias, setCwdAlias, initCwdAliases } from "@/hooks/cwdAliasStore";
import { useAllPendingAskUserQuestions } from "@/hooks/askUserQuestionsStore";
import { usePendingPermissionSessionIds } from "@/hooks/usePendingPermissions";
import { sessionAttentionById, type SessionAttention } from "@/lib/shared/session-attention";
import { SESSION_PAGE_SIZE_GROUPED, insertActiveSession } from "@/lib/shared/sidebar-paging";

export interface CwdSessionsState {
  sessions: SessionInfo[];
  cursor: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  loadError: string | null;
}

interface MultiCwdListProps {
  workspaces: Workspace[];
  emptyMessage?: string;
  loadingWorkspaces: boolean;
  loadingMoreWorkspaces: boolean;
  hasMoreWorkspaces: boolean;
  showFallbackLoadMore: boolean;
  workspaceLoadError: string | null;
  expandedCwd: string | null;
  perCwdSessions: Record<string, CwdSessionsState>;
  favoriteIds: string[];
  selectedSessionId: string | null;
  activeSession?: SessionInfo | null;

  onCwdHeaderRef: (cwd: string, el: HTMLDivElement | null) => void;

  onToggleExpand: (cwd: string) => void;
  onSelectSession: (session: SessionInfo) => void;
  onLoadMoreWorkspaces: () => void;
  onLoadMoreCwdSessions: (cwd: string) => void;
  onToggleFavorite?: (sessionId: string) => void;
  onSessionRenamed: (sessionId: string, name: string) => void;
  onSessionDeleted: (sessionId: string) => void;
  onNewSession?: (cwd: string) => void;
  onOpenCwdSessions: (cwd: string) => void;
}

export function MultiCwdList({
  workspaces,
  emptyMessage,
  loadingWorkspaces,
  loadingMoreWorkspaces,
  hasMoreWorkspaces,
  showFallbackLoadMore,
  workspaceLoadError,
  expandedCwd,
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
  onOpenCwdSessions,
}: MultiCwdListProps) {
  const { t } = useI18n();

  const pendingQuestions = useAllPendingAskUserQuestions();
  const pendingPermissionSessionIds = usePendingPermissionSessionIds();
  const attentionBySessionId = sessionAttentionById(
    pendingQuestions.map((pending) => pending.sessionId),
    pendingPermissionSessionIds,
  );

  return (
    <div style={{ padding: "4px 8px 8px", minHeight: 80, display: "flex", flexDirection: "column", gap: 8 }}>
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
          {emptyMessage ?? t("No projects yet")}
        </div>
      )}

      {workspaces.map((ws) => {
        const expanded = expandedCwd === ws.cwd;
        const group = perCwdSessions[ws.cwd];
        const activeSessionInCwd = activeSession?.cwd === ws.cwd ? activeSession : null;
        const sessions = insertActiveSession(
          group?.sessions ?? [],
          activeSessionInCwd,
          SESSION_PAGE_SIZE_GROUPED,
          (session) => session.id,
        );
        const displayGroup: CwdSessionsState | undefined = !group
          ? (sessions.length > 0
            ? {
                sessions,
                cursor: null,
                hasMore: false,
                loading: false,
                loadingMore: false,
                loadError: null,
              }
            : undefined)
          : sessions === group.sessions
            ? group
            : { ...group, sessions };

        return (
          <CwdGroup
            key={ws.cwd}
            workspace={ws}
            expanded={expanded}
            group={displayGroup}
            favoriteIds={favoriteIds}
            selectedSessionId={selectedSessionId}
            attentionBySessionId={attentionBySessionId}
            onHeaderRef={(el) => onCwdHeaderRef(ws.cwd, el)}
            onToggleExpand={() => onToggleExpand(ws.cwd)}
            onSelectSession={onSelectSession}
            onLoadMoreSessions={() => onLoadMoreCwdSessions(ws.cwd)}
            onOpenCwdSessions={() => onOpenCwdSessions(ws.cwd)}
            onToggleFavorite={onToggleFavorite}
            onSessionRenamed={onSessionRenamed}
            onSessionDeleted={onSessionDeleted}
            onNewSession={onNewSession}
          />
        );
      })}

      {loadingMoreWorkspaces && (
        <div style={{ padding: "4px 8px 0", color: "var(--text-dim)", fontSize: 10, textAlign: "center" }}>
          {t("Loading more...")}
        </div>
      )}
      {showFallbackLoadMore && hasMoreWorkspaces && !loadingMoreWorkspaces && (
        <button
          onClick={onLoadMoreWorkspaces}
          style={{
            alignSelf: "center",
            padding: "5px 14px",
            background: "var(--bg-hover)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            marginTop: 2,
          }}
        >
          {t("Load more projects")}
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
  attentionBySessionId: ReadonlyMap<string, SessionAttention>;

  onHeaderRef: (el: HTMLDivElement | null) => void;
  onToggleExpand: () => void;
  onSelectSession: (session: SessionInfo) => void;
  onLoadMoreSessions: () => void;
  onOpenCwdSessions: () => void;
  onToggleFavorite?: (sessionId: string) => void;
  onSessionRenamed: (sessionId: string, name: string) => void;
  onSessionDeleted: (sessionId: string) => void;
  onNewSession?: (cwd: string) => void;
}

function CwdGroup({
  workspace,
  expanded,
  group,
  favoriteIds,
  selectedSessionId,
  attentionBySessionId,
  onHeaderRef,
  onToggleExpand,
  onSelectSession,
  onLoadMoreSessions,
  onOpenCwdSessions,
  onToggleFavorite,
  onSessionRenamed,
  onSessionDeleted,
  onNewSession,
}: CwdGroupProps) {
  const { t } = useI18n();
  const headerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    initCwdIcons();
    initCwdAliases();
  }, []);
  const cwdIcon = useCwdIcon(workspace.cwd);
  const cwdAlias = useCwdAlias(workspace.cwd);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [aliasDialogOpen, setAliasDialogOpen] = useState(false);
  const [toolsPickerOpen, setToolsPickerOpen] = useState(false);

  useEffect(() => {
    onHeaderRef(headerRef.current);
    return () => onHeaderRef(null);
  }, [onHeaderRef]);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [allowAnim, setAllowAnim] = useState(false);
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  const [rendered, setRendered] = useState(expanded);
  const [collapsed, setCollapsed] = useState(!expanded);

  useEffect(() => {
    const id = requestAnimationFrame(() => setAllowAnim(true));
    return () => cancelAnimationFrame(id);
  }, []);

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

  useEffect(() => {
    if (expanded) setRendered(true);
  }, [expanded]);

  useEffect(() => {
    if (expanded && rendered && bodyHeight != null) setCollapsed(false);
  }, [expanded, rendered, bodyHeight]);

  useEffect(() => {
    if (expanded) return;
    setCollapsed(true);
    const timer = window.setTimeout(() => setRendered(false), 220);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  const sessions = group?.sessions ?? [];
  const orderedSessions = sessions.slice().sort((a, b) => b.modified.localeCompare(a.modified));

  const lastSessionId = orderedSessions.length > 0 ? orderedSessions[orderedSessions.length - 1].id : null;
  const canLoadMore = !!group?.hasMore;

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
      attention={attentionBySessionId.get(s.id)}
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

  const [rowHovered, setRowHovered] = useState(false);
  const [triggerHovered, setTriggerHovered] = useState(false);
  const [loadMenuOpen, setLoadMenuOpen] = useState(false);
  const [loadMenuPos, setLoadMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [loadMenuVisible, setLoadMenuVisible] = useState(false);
  const loadMenuRef = useRef<HTMLDivElement | null>(null);
  const loadMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const showLoadMoreTrigger = rowHovered || triggerHovered || loadMenuOpen;

  const cancelMenuClose = useCallback(() => {
  }, []);

  const openLoadMenu = useCallback(() => {
    cancelMenuClose();
    if (!loadMenuTriggerRef.current) return;
    const rect = loadMenuTriggerRef.current.getBoundingClientRect();
    setLoadMenuPos({ top: rect.top, left: rect.right + 6 });
    setLoadMenuOpen(true);
  }, [cancelMenuClose]);

  useEffect(() => {
    if (!loadMenuOpen) {
      setLoadMenuVisible(false);
      return;
    }
    const id = requestAnimationFrame(() => setLoadMenuVisible(true));
    return () => cancelAnimationFrame(id);
  }, [loadMenuOpen]);

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        ref={headerRef}
        onClick={onToggleExpand}
        onMouseEnter={() => setRowHovered(true)}
        onMouseLeave={() => setRowHovered(false)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleExpand(); } }}
        aria-expanded={expanded}
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
        <span
          aria-hidden
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 16, height: 22,
            color: "var(--accent)",
            flexShrink: 0,
          }}
        >
          <CwdProjectIcon cwd={workspace.cwd} size={14} />
        </span>

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
          <Tooltip content={workspace.cwd} maxWidth={480}>
            <span style={{
              flex: "0 1 auto", minWidth: 0,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {cwdAlias ?? basenameOf(workspace.cwd)}
            </span>
          </Tooltip>

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
                label={t("View more sessions")}
                onClick={() => {
                  setLoadMenuOpen(false);
                  onOpenCwdSessions();
                }}
              />
            )}
            <CwdMenuRow
              index={1}
              icon={<span aria-hidden>⚙</span>}
              label={t("Set default tools")}
              onClick={() => {
                setLoadMenuOpen(false);
                setToolsPickerOpen(true);
              }}
            />
            <CwdMenuRow
              index={2}
              icon={<span aria-hidden>✎</span>}
              label={t("Set project alias")}
              onClick={() => {
                setLoadMenuOpen(false);
                cancelMenuClose();
                setAliasDialogOpen(true);
              }}
            />
            <CwdMenuRow
              index={3}
              icon={
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12" />
                  <path d="M7 8l5-5 5 5" />
                  <path d="M5 21h14" />
                </svg>
              }
              label={t("Set custom icon")}
              onClick={() => {
                setLoadMenuOpen(false);
                cancelMenuClose();
                setIconPickerOpen(true);
              }}
            />
          </div>,
          document.body,
        )}

      </div>

      {rendered && (
        <div
          style={{
            height: collapsed ? 0 : bodyHeight ?? undefined,
            overflow: "hidden",
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

      {toolsPickerOpen && (
        <CwdToolsPicker cwd={workspace.cwd} open onClose={() => setToolsPickerOpen(false)} />
      )}
      {iconPickerOpen && (
        <CwdIconPicker
          open
          title={t("Set custom icon")}
          current={cwdIcon ?? null}
          onSelect={async (icon) => {
            const ok = await setCwdIcon(workspace.cwd, icon);
            if (ok) setIconPickerOpen(false);
          }}
          onClose={() => setIconPickerOpen(false)}
        />
      )}
      {aliasDialogOpen && (
        <CwdAliasDialog
          open
          cwd={workspace.cwd}
          current={cwdAlias ?? null}
          onSave={(alias) => setCwdAlias(workspace.cwd, alias)}
          onClose={() => setAliasDialogOpen(false)}
        />
      )}
    </div>
  );
}

function basenameOf(cwd: string): string {
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
        paddingLeft: 8,
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