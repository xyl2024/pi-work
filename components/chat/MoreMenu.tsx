"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AnimatedPopover } from "../ui/AnimatedPopover";
import { useChatHeaderActions } from "@/hooks/chatHeaderActionsStore";
import type { ChannelRecord } from "@/lib/shared/channels/types";

/**
 * The `…` button and its upward menu, surfaced in the bottom-right of
 * the chat input. The button is conditionally rendered: if no ChatHeader
 * actions are visible (no session, or every action is gated off) and
 * nothing was folded in from the toolbar, the whole component returns
 * `null`.
 *
 * The menu opens only on click of the trigger (no hover, no tooltip);
 * it toggles off on a second click of the trigger, on a click outside
 * the container, or on selecting an item. "Notification channel" opens
 * an in-menu submenu listing the messaging channels (WeChat) for the
 * current session's reply notifications.
 *
 * A third view ("collapsed") hosts the controls the bottom toolbar gave up
 * when the chat column got too narrow to hold them. Callers pass them as
 * fully-formed entries (`collapsed` prop); when nothing is passed the menu is
 * byte-for-byte the menu it was before that feature existed.
 */

import {
  CompressIcon,
  DownloadIcon,
  EditIcon,
  NotificationIcon,
  RefreshIcon,
} from "@/components/ui/icons";

type SubmenuView = "channels" | "collapsed";
type View = "main" | SubmenuView;

type Item = {
  key: string;
  label: string;
  /** Rendered inline before the label. */
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Set for entries that switch views instead of closing the menu. */
  submenu?: SubmenuView;
};

/** An affordance the bottom toolbar folded into this menu to avoid overflow. */
export interface CollapsedMenuEntry {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

export interface MoreMenuProps {
  /**
   * Controls the toolbar could not fit, in the order they should be listed.
   * Omitted/empty (`undefined`, `[]`) keeps the pre-existing behaviour: no
   * entry point, no extra view.
   */
  collapsedItems?: CollapsedMenuEntry[];
}

export function MoreMenu({ collapsedItems }: MoreMenuProps) {
  const { t } = useI18n();
  const headerActions = useChatHeaderActions();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("main");
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const collapsedEntries = collapsedItems ?? [];

  // Reset to the main menu every time the menu reopens.
  useEffect(() => {
    if (open) setView("main");
  }, [open]);

  // Channel list powers the notification submenu and resolves the current
  // binding's display name. Refreshed on each open so channels bound or
  // removed elsewhere show up immediately.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/channels?provider=wechat", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { channels?: ChannelRecord[] }) => {
        if (!cancelled) setChannels(d.channels ?? []);
      })
      .catch(() => {
        // transient — the submenu stays usable with an empty list
      });
    return () => { cancelled = true; };
  }, [open]);

  const currentBinding =
    headerActions?.currentNotifyChannelId != null
      ? channels.find((c) => c.id === headerActions.currentNotifyChannelId)?.name ?? null
      : null;

  // The "collapsed controls" entry is part of `items` on purpose: it keeps the
  // "menu with nothing in it closes itself" logic below working unchanged.
  const hasCollapsed = collapsedEntries.length > 0;

  const items = useMemo<Item[]>(() => {
    const actionItems: (Item | null)[] = !headerActions ? [] : [
      headerActions.replayVisible ? {
        key: "replay",
        label: t("Replay"),
        icon: <RefreshIcon size={14} />,
        onClick: headerActions.onOpenReplay,
      } : null,
      headerActions.exportVisible ? {
        key: "export",
        label: headerActions.isExporting ? t("Exporting...") : t("Export session"),
        icon: <DownloadIcon size={14} />,
        onClick: headerActions.onExport,
        disabled: headerActions.isExporting,
      } : null,
      headerActions.autoNameVisible ? {
        key: "auto-name",
        label: headerActions.isAutoNaming ? t("Naming...") : t("Auto-name session"),
        icon: <EditIcon size={14} />,
        onClick: headerActions.onAutoName,
        disabled: headerActions.isAutoNaming || !headerActions.canAutoName,
      } : null,
      headerActions.compactVisible ? {
        key: "compact",
        label: headerActions.isCompacting ? t("Compacting...") : t("Compact"),
        icon: <CompressIcon size={14} />,
        onClick: headerActions.onCompact,
        disabled: headerActions.isCompacting || headerActions.compactDisabled,
      } : null,
      headerActions.notifyVisible ? {
        key: "notify",
        label: currentBinding
          ? `${t("Notification channel")} · ${currentBinding}`
          : t("Notification channel"),
        icon: <NotificationIcon size={14} />,
        onClick: () => setView("channels"),
        submenu: "channels",
      } : null,
    ];

    if (hasCollapsed) {
      actionItems.push({
        key: "collapsed-controls",
        label: t("More actions"),
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </svg>
        ),
        onClick: () => setView("collapsed"),
        submenu: "collapsed",
      });
    }

    return actionItems.filter(Boolean) as Item[];
  }, [headerActions, t, currentBinding, hasCollapsed]);

  const selectChannel = (channelId: string | null) => {
    if (!headerActions) return;
    headerActions.onSetNotifyChannel(channelId);
    setView("main");
    setOpen(false);
  };

  // Close the menu if the action list drops to zero (e.g. session
  // switched away mid-open). Without this, the open button would
  // outlive its trigger. Folded controls are part of `items`, so a menu
  // that only hosts them stays open.
  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  // Click outside the trigger + menu closes the menu. Listener is only
  // attached while the menu is open so we don't pay the global cost
  // when the popover is closed.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // The toolbar can win its controls back while the menu is open (the window
  // got wider). The collapsed view has nothing left to show then, so fall back
  // to the main list instead of an empty submenu.
  useEffect(() => {
    if (view === "collapsed" && !hasCollapsed) setView("main");
  }, [view, hasCollapsed]);

  if (items.length === 0) return null;

  const renderSubmenuHeader = (title: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 4px 6px" }}>
      <button
        type="button"
        aria-label={t("Back")}
        onClick={() => setView("main")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          padding: 0,
          border: "none",
          borderRadius: 6,
          background: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        ←
      </button>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
        {title}
      </span>
    </div>
  );

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", display: "flex", alignItems: "center" }}
    >
      <button
        type="button"
        aria-label={t("More actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          padding: 0,
          flexShrink: 0,
          border: "none",
          borderRadius: 9999,
          background: open ? "var(--bg-hover)" : "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = open ? "var(--bg-hover)" : "none";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      <AnimatedPopover
        open={open}
        role="menu"
        maxHeight={320}
        style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          right: 0,
          zIndex: 120,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
          minWidth: view === "channels" ? 240 : 180,
        }}
      >
        {view === "channels" ? (
          <div style={{ display: "flex", flexDirection: "column", padding: "4px" }}>
            {/* Submenu header: back + title */}
            {renderSubmenuHeader(t("Notification channel"))}

            {/* No notification */}
            <button
              type="button"
              onClick={() => selectChannel(null)}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                padding: "8px 10px",
                border: "none",
                borderRadius: 6,
                background: headerActions?.currentNotifyChannelId == null ? "var(--bg-selected)" : "none",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: 12,
                textAlign: "left",
              }}
            >
              <span style={{ flex: 1 }}>{t("No notification")}</span>
              {headerActions?.currentNotifyChannelId == null && (
                <span style={{ color: "var(--accent)" }}>✓</span>
              )}
            </button>

            <div style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />

            {channels.length === 0 ? (
              <p style={{ margin: 0, padding: "8px 10px", fontSize: 12, color: "var(--text-muted)" }}>
                {t("channels.noChannels")}
              </p>
            ) : (
              channels.map((channel) => {
                const selectable = channel.status === "connected" && !!channel.userId;
                const isSelected = headerActions?.currentNotifyChannelId === channel.id;
                const statusColor =
                  channel.status === "connected" ? "var(--accent)"
                    : channel.status === "expired" ? "#ef4444"
                      : channel.status === "disabled" ? "var(--text-muted)"
                        : "#f59e0b";
                return (
                  <button
                    key={channel.id}
                    type="button"
                    disabled={!selectable}
                    onClick={() => selectChannel(channel.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "8px 10px",
                      border: "none",
                      borderRadius: 6,
                      background: isSelected ? "var(--bg-selected)" : "none",
                      color: selectable ? "var(--text)" : "var(--text-dim)",
                      cursor: selectable ? "pointer" : "not-allowed",
                      fontSize: 12,
                      textAlign: "left",
                      opacity: selectable ? 1 : 0.6,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 4, background: statusColor, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {channel.name}
                    </span>
                    {!selectable && (
                      <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>
                        {channel.status === "connected" ? t("channels.notScanned") : t(`channels.${channel.status}`)}
                      </span>
                    )}
                    {isSelected && <span style={{ color: "var(--accent)" }}>✓</span>}
                  </button>
                );
              })
            )}
          </div>
        ) : view === "collapsed" ? (
          <div style={{ display: "flex", flexDirection: "column", padding: "4px" }}>
            {renderSubmenuHeader(t("More actions"))}
            {collapsedEntries.map((entry) => (
              <MenuRow
                key={entry.key}
                icon={entry.icon}
                label={entry.label}
                onClick={() => {
                  setOpen(false);
                  entry.onClick();
                }}
              />
            ))}
          </div>
        ) : (
          items.map((item) => (
            <MenuRow
              key={item.key}
              icon={item.icon}
              label={item.label}
              disabled={item.disabled}
              onClick={() => {
                if (item.submenu) {
                  setView(item.submenu);
                  return;
                }
                setOpen(false);
                item.onClick();
              }}
            />
          ))
        )}
      </AnimatedPopover>
    </div>
  );
}

/** One clickable row of the menu. Shared by the main list and the collapsed
 *  list so the two stay consistent. */
function MenuRow({ icon, label, disabled = false, onClick }: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        lineHeight: 1,
        width: "100%",
        padding: "8px 12px",
        border: "none",
        background: "none",
        color: disabled ? "var(--text-dim)" : "var(--text-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12,
        textAlign: "left",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "var(--bg-hover)";
        e.currentTarget.style.color = "var(--text)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "none";
        e.currentTarget.style.color = "var(--text-muted)";
      }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  );
}
