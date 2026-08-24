"use client";

import { forwardRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

export interface PickerTriggerProps {
  /** Whether the popover is open. Forwarded to `aria-expanded`. */
  open: boolean;
  /** Toggle handler wired to the trigger button. */
  onClick: () => void;
  /** Icon shown on the leading edge (e.g. calendar / clock). */
  icon: ReactNode;
  /** Text shown in the trigger. `null`/`undefined` renders `placeholder`. */
  label?: ReactNode;
  /** Placeholder shown when `label` is empty. */
  placeholder?: ReactNode;
  /** Whether to show the inline "×" clear button. Default: `true`. */
  clearable?: boolean;
  /** Whether the picker currently has a value. Controls whether the clear
   *  button is shown. */
  hasValue: boolean;
  /** Clears the value without toggling the popover. */
  onClear: () => void;
  /** Accessible label for the default trigger. */
  ariaLabel?: string;
  /** Visual sizing. `compact` matches the small inline default; `regular`
   *  matches the form-input style used in dialogs. Default: `"compact"`. */
  size?: "compact" | "regular";
  /** Style overrides merged into the default trigger button. */
  style?: CSSProperties;
  /** Whether to use the monospace stack for the label (used by TimePicker). */
  monoLabel?: boolean;
}

/**
 * The default trigger button shared by DatePicker / TimePicker. Renders a
 * compact or regular-sized bordered button with a leading icon, a label
 * slot, and an optional inline "×" that clears the value without opening
 * the popover. Consumers who need a custom trigger should ignore this
 * component and use `renderTrigger` instead.
 */
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
    // preventDefault avoids losing the button's focus / selection when the
    // mousedown lands on the inner span.
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
