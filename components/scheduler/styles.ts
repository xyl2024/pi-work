import type { CSSProperties } from "react";

export const inputStyle: CSSProperties = {
  width: "100%",
  fontSize: 13,
  padding: "7px 10px",
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
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-muted)",
  marginBottom: 6,
};

export const fieldHintStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  marginTop: 6,
  lineHeight: 1.45,
};

export const fieldErrorStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--error)",
  marginTop: 5,
};

export const sectionTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "var(--text)",
};

export const codePillStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  padding: "1px 6px",
  background: "var(--bg-subtle)",
  borderRadius: 4,
  color: "var(--text)",
};

export const btnPrimary: CSSProperties = {
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "7px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

export const btnGhost: CSSProperties = {
  background: "transparent",
  color: "var(--text-muted)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};
