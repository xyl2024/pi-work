"use client";

import type { CSSProperties, ReactNode } from "react";
import { Tooltip } from "./Tooltip";
import styles from "./IconButton.module.css";

export type IconButtonSize = "xs" | "sm" | "md";
export type IconButtonVariant = "ghost" | "subtle" | "primary";

export interface IconButtonProps {
  label: string;
  onClick?: () => void;
  children?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  active?: boolean;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  tooltip?: boolean;
  type?: "button" | "submit" | "reset";
  style?: CSSProperties;
  className?: string;
}

const sizes: Record<IconButtonSize, CSSProperties> = {
  xs: { width: 22, height: 22, minWidth: 22, borderRadius: "var(--radius-xs)", fontSize: 12 },
  sm: { width: 30, height: 30, minWidth: 30, borderRadius: "var(--radius-sm)", fontSize: 12 },
  md: { width: 34, height: 34, minWidth: 34, borderRadius: "var(--radius-sm)", fontSize: 13 },
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
  const variantClass = variant === "primary"
    ? styles.primary
    : active
      ? styles.active
      : variant === "subtle"
        ? styles.subtle
        : "";

  const button = (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active || undefined}
      className={[styles.button, variantClass, className].filter(Boolean).join(" ")}
      style={{ ...sizes[size], ...style }}
    >
      {children ?? icon}
    </button>
  );

  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
