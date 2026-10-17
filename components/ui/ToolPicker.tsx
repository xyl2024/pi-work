"use client";

/**
 * Shared presentational pieces for the two tool pickers
 * (`ToolsPickerModal` for the active session, `CwdToolsPicker` for a
 * project's default tool set). Keeping the visuals in one place guarantees
 * the chat picker and the settings picker stay pixel-consistent.
 *
 * The structural class (`tool-picker__row`) lives in `app/globals.css` so
 * `:hover`, `:active`, and the `[data-*]` driven selected / focused fills can
 * transition smoothly; this file only supplies the inline layout metrics, the
 * hand-drawn checkbox glyph, and the correct data attributes.
 *
 * Each component forwards a ref and spreads its remaining DOM props so it can
 * be used as the asChild trigger of a Radix `Tooltip`.
 */

import { forwardRef } from "react";
import type { CSSProperties, LabelHTMLAttributes } from "react";

/* ── Color helpers (kept readable without a design-token lookup table) ── */
const accentTint = (strength: number) => `color-mix(in srgb, var(--accent) ${strength}%, transparent)`;

/* ---------------------------------------------------------------------- *
 * Custom checkbox — a hand-drawn, fully theme-consistent square that
 * replaces the browser-native `accentColor` checkbox. The real input stays
 * in the DOM (visually hidden) for a11y / keyboard reachability, while the
 * visual box above it carries the checked state.
 * ---------------------------------------------------------------------- */
export function ToolCheckbox({ checked }: { checked: boolean }) {
  return (
    /* A drawn marker styled like the ask-user-questions control: at rest a
       faint rounded-square ring; once checked the ring fades out entirely
       and only an accent, stroke-drawn ✓ remains (it visually "replaces"
       the empty box). The transparent border is kept so the outer size is
       stable and the row doesn't shift when toggled. */
    <span
      aria-hidden="true"
      className="tool-picker__box"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        boxSizing: "border-box",
        flexShrink: 0,
        borderRadius: 5,
        background: "transparent",
        border: `2px solid ${checked ? "transparent" : "color-mix(in srgb, var(--text-dim) 70%, transparent)"}`,
        transition: "border-color 0.15s ease",
      }}
    >
      {checked && (
        <svg
          className="tool-picker__check"
          width="11"
          height="11"
          viewBox="0 0 20 20"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ display: "block" }}
        >
          <path d="M4.8 10.5 8.4 14.2 15.2 6" />
        </svg>
      )}
    </span>
  );
}

/* ---------------------------------------------------------------------- *
 * One tool in the custom-selection checklist.
 * ---------------------------------------------------------------------- */
export interface ToolCheckRowProps {
  /** Canonical tool name shown in mono. */
  name: string;
  checked: boolean;
  /** Keyboard navigation target (arrow-keys / Enter). */
  focused?: boolean;
  /** When the row is a bound family of tools, number of member tools. */
  memberCount?: number;
  onChange: (checked: boolean) => void;
}

type RowBase = Omit<LabelHTMLAttributes<HTMLLabelElement>, "onChange">;

export const ToolCheckRow = forwardRef<HTMLLabelElement, ToolCheckRowProps & RowBase>(
  function ToolCheckRow({ name, checked, focused = false, memberCount = 0, onChange, className, style, ...rest }, ref) {
    const isGroup = memberCount > 0;
    return (
      <label
        {...rest}
        ref={ref}
        data-checked={checked ? "true" : "false"}
        data-focused={focused ? "true" : "false"}
        className={["tool-picker__row", className].filter(Boolean).join(" ")}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 9,
          minWidth: 0,
          padding: "7px 10px",
          borderRadius: 8,
          fontSize: 12,
          userSelect: "none",
          ...(style as CSSProperties),
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 24,
            height: "100%",
            margin: 0,
            opacity: 0,
            cursor: "pointer",
            zIndex: 1,
          }}
        />
        <ToolCheckbox checked={checked} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-mono)",
            fontSize: "inherit",
            color: "var(--text)",
          }}
        >
          {name}
        </span>
        {isGroup && (
          <span
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "1px 6px",
              borderRadius: 999,
              background: accentTint(12),
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              lineHeight: "14px",
            }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <path d="M12 3 20 7 12 11 4 7Z" />
              <path d="M4 12 12 16 20 12" />
              <path d="M4 17 12 21 20 17" />
            </svg>
            {memberCount}
          </span>
        )}
      </label>
    );
  },
);

