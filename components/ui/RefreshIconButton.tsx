"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MorphToggleIcon } from "./MorphToggleIcon";
import { REFRESH, CHECK } from "@/lib/client/icon-paths";
import { Tooltip } from "./Tooltip";
import { useI18n } from "@/hooks/useI18n";

export interface RefreshIconButtonProps {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
  doneMs?: number;
  iconStyle?: React.CSSProperties;
}

export function RefreshIconButton({
  onClick,
  label,
  disabled = false,
  style,
  className,
  doneMs = 2000,
  iconStyle,
}: RefreshIconButtonProps) {
  const { t } = useI18n();
  const tip = label ?? t("Refresh");
  const [done, setDone] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleClick = useCallback(() => {
    if (disabled) return;
    onClick();
    setDone(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDone(false), doneMs);
  }, [disabled, onClick, doneMs]);

  const finalColor = done ? "#4ade80" : "var(--text-dim)";
  const finalBg = done ? "rgba(74,222,128,0.18)" : "none";
  const finalCursor = disabled ? "default" : "pointer";

  return (
    <Tooltip content={tip}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label={tip}
        className={className}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 26, padding: 0,
          background: finalBg, border: "none",
          color: finalColor,
          cursor: finalCursor,
          borderRadius: 5,
          flexShrink: 0,
          transition: "color 0.3s, background 0.3s",
          ...style,
        }}
        onMouseEnter={(e) => {
          if (disabled || done) return;
          e.currentTarget.style.color = "var(--text-muted)";
          e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          if (disabled || done) return;
          e.currentTarget.style.color = "var(--text-dim)";
          e.currentTarget.style.background = "none";
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            ...iconStyle,
          }}
        >
          <MorphToggleIcon from={REFRESH} to={CHECK} active={done} size={13} strokeWidth={2.5} />
        </span>
      </button>
    </Tooltip>
  );
}