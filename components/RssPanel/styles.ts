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
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text)",
  padding: "2px 8px",
  fontSize: 14,
  lineHeight: 1.4,
  cursor: "pointer",
  flexShrink: 0,
};

export const emptyStyle: CSSProperties = {
  padding: "32px 16px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: 12,
};
