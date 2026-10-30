"use client";

import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/Tooltip";

interface RightBarButtonProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  badge?: ReactNode;
}

export function RightBarButton({
  label,
  onClick,
  active = false,
  disabled = false,
  icon,
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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
        {icon}
        {badge}
      </button>
    </Tooltip>
  );
}
