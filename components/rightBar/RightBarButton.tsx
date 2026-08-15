"use client";

import type { ReactNode } from "react";
import { Tooltip } from "@/components/Tooltip";

// Shared visual shell for every 36×36 button in the right column. Pulls the
// hover-color flip, active highlight, disabled treatment, and tooltip wrapper
// out of AppShell so that adding a new toggle-button is purely a descriptor
// change.
//
// Variants:
//   - Default: single SVG icon, hover → var(--text), active → var(--accent).
//   - withChildren: pass `children` (e.g. <WrenchIcon/> + <span>r/t</span>)
//     to take over the icon slot for compact buttons that overlay a label
//     (tool calls: running/total).
//   - withBadge: pass `badge` to render a small absolute-positioned node in
//     the top-right corner (RSS unread count). The parent is `position:
//     relative` so the badge anchors to the button.

interface RightBarButtonProps {
  /** Tooltip + aria-label. Keep it short (one or two words). */
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Layout direction for `children`/`icon`. Default 'row' (icon only).
   *  Tool-calls uses 'column' to stack the icon and the running/total
   *  counter vertically. */
  flexDirection?: "row" | "column";
  /** Gap between children when more than one is rendered (e.g. column
   *  layout for tool-calls). */
  gap?: number;
  /** Default icon. Ignored if `children` is provided. */
  icon?: ReactNode;
  /** Overrides `icon`. Use for custom-content layouts (e.g. tool-call counter). */
  children?: ReactNode;
  /** Top-right corner badge. Absolute-positioned inside the button. */
  badge?: ReactNode;
}

export function RightBarButton({
  label,
  onClick,
  active = false,
  disabled = false,
  flexDirection = "row",
  gap,
  icon,
  children,
  badge,
}: RightBarButtonProps) {
  const color = disabled
    ? "var(--text-dim)"
    : active
      ? "var(--accent)"
      : "var(--text-muted)";
  const hoverColor = "var(--accent)";

  const style: React.CSSProperties = {
    position: "relative",
    display: "flex",
    flexDirection,
    alignItems: "center",
    justifyContent: "center",
    ...(gap !== undefined ? { gap } : null),
    width: 36,
    height: 36,
    padding: 0,
    background: "transparent",
    border: "none",
    color,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    transition: "color 0.12s",
  };

  return (
    <Tooltip content={label} side="left">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        style={style}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.color = hoverColor;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = color;
        }}
      >
        {children ?? icon}
        {badge}
      </button>
    </Tooltip>
  );
}
