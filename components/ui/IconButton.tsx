"use client";

import type { CSSProperties, ReactNode } from "react";
import { Tooltip } from "./Tooltip";

export type IconButtonSize = "xs" | "sm" | "md";
export type IconButtonVariant = "ghost" | "subtle" | "primary";

export interface IconButtonProps {
  /** Accessible name; also used as the decorative tooltip by default. */
  label: string;
  onClick?: () => void;
  children?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  active?: boolean;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  /** Set false when the parent already provides a tooltip. */
  tooltip?: boolean;
  type?: "button" | "submit" | "reset";
  style?: CSSProperties;
  className?: string;
}

const sizes: Record<IconButtonSize, CSSProperties> = {
  xs: { width: 20, height: 20, minWidth: 20, borderRadius: 4, fontSize: 12 },
  sm: { width: 28, height: 28, minWidth: 28, borderRadius: 5, fontSize: 12 },
  md: { width: 32, height: 32, minWidth: 32, borderRadius: 6, fontSize: 13 },
};

export function IconButton({
  label,
  onClick,
  children,
  icon,
  disabled = false,
  active = false,
  size = "sm",
  variant = "ghost",
  tooltip = true,
  type = "button",
  style,
  className,
}: IconButtonProps) {
  const baseColor = disabled
    ? "var(--text-dim)"
    : variant === "primary"
      ? "var(--bg)"
      : active
        ? "var(--text)"
        : "var(--text-muted)";
  const baseBackground = variant === "primary"
    ? "var(--accent)"
    : active
      ? "var(--bg-selected)"
      : variant === "subtle"
        ? "var(--bg-subtle)"
        : "transparent";

  const button = (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={className}
      style={{
        ...sizes[size],
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        padding: 0,
        gap: 4,
        background: baseBackground,
        color: baseColor,
        border: variant === "subtle" || active ? "1px solid var(--border)" : "1px solid transparent",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        lineHeight: 1,
        transition: "background 0.12s, color 0.12s, border-color 0.12s",
        ...style,
      }}
      onMouseEnter={(event) => {
        if (!disabled && variant !== "primary") {
          event.currentTarget.style.background = active ? "var(--bg-selected)" : "var(--bg-hover)";
          event.currentTarget.style.color = "var(--text)";
        }
      }}
      onMouseLeave={(event) => {
        if (!disabled) {
          event.currentTarget.style.background = baseBackground;
          event.currentTarget.style.color = baseColor;
        }
      }}
    >
      {children ?? icon}
    </button>
  );

  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
