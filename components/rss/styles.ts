/**
 * Shared inline-style primitives for the RSS panel.
 *
 * `iconBtnStyle` is the small square button used throughout the panel
 * (back / refresh / add / delete). `emptyStyle` is the centered muted
 * placeholder text shown when a list / view has no content. Both are
 * `var(--*)` so they follow the active theme.
 */
import type { CSSProperties } from "react";

export const iconBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  padding: 0,
  background: "transparent",
  border: "none",
  borderRadius: 5,
  color: "var(--text-dim)",
  cursor: "pointer",
  flexShrink: 0,
  transition: "color 120ms ease, background-color 120ms ease",
};

export const emptyStyle: CSSProperties = {
  padding: "32px 16px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: 12,
};
