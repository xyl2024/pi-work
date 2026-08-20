"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AnimatedPopover } from "../ui/AnimatedPopover";
import { useChatHeaderActions } from "@/hooks/chatHeaderActionsStore";

/**
 * The `…` button and its upward menu, surfaced in the bottom-right of
 * the chat input. The button is conditionally rendered: if no ChatHeader
 * actions are visible (no session, or every action is gated off), the
 * whole component returns `null`.
 *
 * The menu opens only on click of the trigger (no hover, no tooltip);
 * it toggles off on a second click of the trigger, on a click outside
 * the container, or on selecting an item.
 */
export function MoreMenu() {
  const { t } = useI18n();
  const headerActions = useChatHeaderActions();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    if (!headerActions) return [];
    return [
      headerActions.replayVisible ? { key: "replay", label: t("Replay"), onClick: headerActions.onOpenReplay } : null,
      headerActions.exportVisible ? {
        key: "export",
        label: headerActions.isExporting ? t("Exporting...") : t("Export session"),
        onClick: headerActions.onExport,
        disabled: headerActions.isExporting,
      } : null,
      headerActions.autoNameVisible ? {
        key: "auto-name",
        label: headerActions.isAutoNaming ? t("Naming...") : t("Auto-name session"),
        onClick: headerActions.onAutoName,
        disabled: headerActions.isAutoNaming || !headerActions.canAutoName,
      } : null,
      headerActions.compactVisible ? {
        key: "compact",
        label: headerActions.isCompacting ? t("Compacting...") : t("Compact"),
        onClick: headerActions.onCompact,
        disabled: headerActions.isCompacting || headerActions.compactDisabled,
      } : null,
    ].filter((item): item is { key: string; label: string; onClick: () => void; disabled?: boolean } => Boolean(item));
  }, [headerActions, t]);

  // Close the menu if the action list drops to zero (e.g. session
  // switched away mid-open). Without this, the open button would
  // outlive its trigger.
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

  if (items.length === 0) return null;

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
        style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          right: 0,
          zIndex: 120,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
          minWidth: 180,
        }}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setOpen(false);
              item.onClick();
            }}
            disabled={item.disabled}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              padding: "8px 12px",
              border: "none",
              background: "none",
              color: item.disabled ? "var(--text-dim)" : "var(--text-muted)",
              cursor: item.disabled ? "not-allowed" : "pointer",
              fontSize: 12,
              textAlign: "left",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              if (item.disabled) return;
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              if (item.disabled) return;
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            {item.label}
          </button>
        ))}
      </AnimatedPopover>
    </div>
  );
}
