import type { CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { statusVar, type StatusVariant } from "./utils";

interface Props {
  status: StatusVariant;
  size?: "sm" | "md";
  bare?: boolean;
  className?: string;
  style?: CSSProperties;
}

function iconFor(variant: StatusVariant): string | null {
  switch (variant) {
    case "success":  return "✓";
    case "error":    return "✕";
    case "timeout":  return "⏱";
    case "interrupted": return "!";
    case "running":  return "●";
    case "paused":
    case "disabled": return "⏸";
    case "enabled":  return "●";
    case "done":     return "✓";
    default:         return null;
  }
}

export function StatusBadge({ status, size = "sm", bare = false, className, style }: Props) {
  const { t } = useI18n();
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
      {!bare && <span>{status ? t(status) : "—"}</span>}
    </span>
  );
}