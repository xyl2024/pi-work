/**
 * Shared inline-style primitives for the scheduler UI.
 *
 * Centralising these avoids the magic-number drift the old SchedulerModal
 * had (different sub-components hard-coding the same `padding: 6px 10px`
 * slightly differently). Every component here uses `var(--*)` so theming
 * works without per-component overrides.
 */

import type { CSSProperties } from "react";

// ── Inputs / fields ──────────────────────────────────────────────
export const inputStyle: CSSProperties = {
  width: "100%",
  fontSize: 12,
  padding: "6px 9px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  outline: "none",
  background: "var(--bg)",
  color: "var(--text)",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export const inputMonoStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: "var(--font-mono)",
};

export const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  minHeight: 96,
  fontFamily: "var(--font-mono)",
  lineHeight: 1.55,
};

export const fieldLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

export const fieldHintStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted)",
  marginTop: 5,
  lineHeight: 1.45,
};

export const fieldErrorStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--error)",
  marginTop: 4,
};

// ── Buttons ──────────────────────────────────────────────────────
export const btnPrimary: CSSProperties = {
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

export const btnSecondary: CSSProperties = {
  background: "var(--bg-hover)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "5px 12px",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};

export const btnGhost: CSSProperties = {
  background: "transparent",
  color: "var(--text-muted)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "5px 10px",
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};

export const btnIcon: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  padding: 0,
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: 5,
  color: "var(--text-muted)",
  cursor: "pointer",
  transition: "background 0.12s, border-color 0.12s, color 0.12s",
};

export const btnIconHover: CSSProperties = {
  ...btnIcon,
  borderColor: "var(--border)",
};

// ── Cards / list items ──────────────────────────────────────────
export const cardStyle: CSSProperties = {
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 12px",
};

// ── Misc ─────────────────────────────────────────────────────────
export const dividerStyle: CSSProperties = {
  height: 1,
  background: "var(--border)",
  border: "none",
  margin: "12px 0",
};

export const tabBarStyle: CSSProperties = {
  display: "flex",
  gap: 4,
  padding: "4px 4px",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-panel)",
};

export function tabItemStyle(active: boolean): CSSProperties {
  return {
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    color: active ? "var(--text)" : "var(--text-muted)",
    background: active ? "var(--bg)" : "transparent",
    border: active ? "1px solid var(--border)" : "1px solid transparent",
    borderBottomColor: active ? "var(--bg)" : "transparent",
    borderRadius: "6px 6px 0 0",
    marginBottom: -1,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "color 0.12s",
  };
}

// ── Dropdown option button (for model / thinking / tools) ────────
export function optionButtonStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "6px 10px",
    borderRadius: 5,
    background: active ? "var(--bg-selected)" : "none",
    border: "none",
    color: active ? "var(--text)" : "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12,
    textAlign: "left",
    fontWeight: active ? 600 : 400,
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  };
}