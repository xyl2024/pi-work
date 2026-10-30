import type { CSSProperties } from "react";

export const inputStyle: CSSProperties = {
  width: "100%",
  fontSize: 12,
  padding: "6px 9px",
  border: "1px solid var(--scheduler-input-border, var(--border))",
  borderRadius: 6,
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

export const tabBarStyle: CSSProperties = {
  display: "flex",
  gap: 4,
  padding: "4px 4px",
  background: "var(--bg)",
};

export function tabItemStyle(active: boolean): CSSProperties {
  return {
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    color: active ? "var(--text)" : "var(--text-muted)",
    background: "transparent",
    border: "none",
    borderRadius: "6px 6px 0 0",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "color 0.12s",
  };
}