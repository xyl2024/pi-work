"use client";

import { forwardRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

export interface PickerTriggerProps {
  open: boolean;
  onClick: () => void;
  icon: ReactNode;
  label?: ReactNode;
  placeholder?: ReactNode;
  clearable?: boolean;
  hasValue: boolean;
  onClear: () => void;
  ariaLabel?: string;
  size?: "compact" | "regular";
  style?: CSSProperties;
  monoLabel?: boolean;
}

export const PickerTrigger = forwardRef<HTMLButtonElement, PickerTriggerProps>(function PickerTrigger(
  {
    open,
    onClick,
    icon,
    label,
    placeholder,
    clearable = true,
    hasValue,
    onClear,
    ariaLabel,
    size = "compact",
    style,
    monoLabel,
  },
  ref,
) {
  const { t } = useI18n();
  const showLabel = label != null && label !== "";
  const clearHandler = (e: MouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onClear();
  };
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        fontSize: size === "regular" ? 12 : 11,
        padding: size === "regular" ? "6px 9px" : "1px 4px",
        border: "1px solid var(--border)",
        borderRadius: size === "regular" ? 6 : 3,
        background: "var(--bg)",
        color: showLabel ? "var(--text)" : "var(--text-dim)",
        fontFamily: "inherit",
        cursor: "pointer",
        boxSizing: "border-box",
        textAlign: "left",
        minHeight: size === "regular" ? undefined : 22,
        ...style,
      }}
    >
      {icon}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: monoLabel ? "var(--font-mono)" : undefined,
        }}
      >
        {showLabel ? label : (placeholder ?? t("Pick"))}
      </span>
      {clearable && hasValue && (
        <span
          role="button"
          aria-label={t("Clear")}
          tabIndex={-1}
          onMouseDown={clearHandler}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 14,
            height: 14,
            borderRadius: 3,
            color: "var(--text-dim)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="2" x2="8" y2="8" />
            <line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </span>
      )}
    </button>
  );
});
