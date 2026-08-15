/**
 * StatusBadge — compact pill for task / run status.
 *
 * Renders one of five variants: success, error, timeout, running, paused.
 * The "running" variant has a soft pulse to signal live activity (uses
 * the global `scheduler-running-pulse` keyframes defined in globals.css).
 *
 * Two display sizes: `sm` (compact list rows) and `md` (detail header).
 */

import type { CSSProperties } from "react";
import { statusLabel, statusVar, type StatusVariant } from "./utils";

interface Props {
  status: StatusVariant;
  size?: "sm" | "md";
  /** Hide the leading icon — useful for list rows where the dot already
   *  conveys the same information. */
  bare?: boolean;
  className?: string;
  style?: CSSProperties;
}

function iconFor(variant: StatusVariant): string | null {
  switch (variant) {
    case "success":  return "✓";
    case "error":    return "✕";
    case "timeout":  return "⏱";
    case "running":  return "●";
    case "paused":
    case "disabled": return "⏸";
    case "enabled":  return "●";
    default:         return null;
  }
}

export function StatusBadge({ status, size = "sm", bare = false, className, style }: Props) {
  const { fg, bg } = statusVar(status);
  const icon = iconFor(status);
  const padding = size === "md" ? "3px 9px" : "2px 7px";
  const fontSize = size === "md" ? 12 : 10;
  const isLive = status === "running" && !bare;

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: bare ? 0 : 4,
        padding: bare ? 0 : padding,
        background: bare ? "transparent" : bg,
        color: fg,
        borderRadius: 999,
        fontSize,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {icon !== null && (
        <span
          data-running-pulse={isLive ? "true" : undefined}
          style={{
            display: "inline-block",
            width: size === "md" ? 7 : 6,
            height: size === "md" ? 7 : 6,
            borderRadius: "50%",
            background: "currentColor",
            flexShrink: 0,
          }}
        />
      )}
      {!bare && <span>{statusLabel(status)}</span>}
    </span>
  );
}