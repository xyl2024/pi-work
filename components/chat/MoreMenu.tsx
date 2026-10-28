"use client";

import { useState, useRef, useEffect } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AnimatedPopover } from "../ui/AnimatedPopover";

/**
 * The `…` button and its upward menu, surfaced in the bottom-right of
 * the chat input. It exists ONLY as the overflow home for controls the
 * bottom toolbar folded away when the chat column got too narrow to
 * hold them (callers pass them as fully-formed `collapsedItems`). When
 * nothing is passed — the wide-layout default — the whole component
 * returns `null` and no "more" button is rendered at all.
 *
 * The session actions (Replay / Export / Auto-name / Compact /
 * Notification channel) that used to share this menu now live in
 * ChatWindow's bottom launcher row (MoreActionsRow).
 *
 * The menu opens only on click of the trigger (no hover, no tooltip);
 * it toggles off on a second click of the trigger, on a click outside
 * the container, or on selecting an item.
 */

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
   * Empty/omitted renders nothing (no button, no menu).
   */
  collapsedItems?: CollapsedMenuEntry[];
}

export function MoreMenu({ collapsedItems }: MoreMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const collapsedEntries = collapsedItems ?? [];
  const hasCollapsed = collapsedEntries.length > 0;

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
  // got wider). The menu then has nothing left to show, so close it.
  useEffect(() => {
    if (open && !hasCollapsed) setOpen(false);
  }, [open, hasCollapsed]);

  if (!hasCollapsed) return null;

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
          minWidth: 180,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", padding: "4px" }}>
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
      </AnimatedPopover>
    </div>
  );
}

/** One clickable row of the menu. */
function MenuRow({ icon, label, onClick }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        lineHeight: 1,
        width: "100%",
        padding: "8px 12px",
        border: "none",
        background: "none",
        color: "var(--text-muted)",
        cursor: "pointer",
        fontSize: 12,
        textAlign: "left",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-hover)";
        e.currentTarget.style.color = "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "none";
        e.currentTarget.style.color = "var(--text-muted)";
      }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  );
}
