"use client";

import * as React from "react";

export interface TogglePillProps {
  /** Whether the toggle is in the "on" state. */
  on: boolean;
  /** Receives the next boolean when the user activates the pill. */
  onChange: (next: boolean) => void;
  /** Disables interaction and dims the pill. */
  disabled?: boolean;
  /** Visual size. `sm` is for compact rows; `md` is the default. */
  size?: "sm" | "md";
  /** Accessible label for screen readers. Falls back to a generic string. */
  label?: string;
}

/**
 * TogglePill — a minimal On/Off pill switch.
 *
 * Renders as a single button with role="switch" so it is fully keyboard
 * accessible (Space/Enter toggle). Text inside the pill is hard-coded to
 * "ON" / "OFF" (uppercase) to keep the affordance uniform across the app.
 *
 * Stops click propagation so it can be safely embedded inside clickable
 * list rows / cards without triggering the parent's click handler.
 */
export function TogglePill({
  on,
  onChange,
  disabled = false,
  size = "md",
  label = "Toggle",
}: TogglePillProps) {
  const isSm = size === "sm";
  const minWidth = isSm ? 36 : 44;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onChange(!on);
      }}
      style={{
        // Fixed minWidth keeps the pill identical in both states even though
        // "OFF" is one letter wider than "ON".
        minWidth,
        padding: isSm ? "2px 9px" : "3px 11px",
        fontSize: isSm ? 10 : 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        lineHeight: 1.5,
        fontFamily: "inherit",
        textAlign: "center",
        borderRadius: 999,
        border: "1px solid",
        borderColor: on ? "var(--accent)" : "var(--border)",
        background: on ? "var(--accent)" : "var(--bg-hover)",
        color: on ? "#fff" : "var(--text-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        boxShadow: on
          ? "0 0 0 1px var(--accent), inset 0 0 0 1px rgba(255,255,255,0.18)"
          : "none",
        transform: "scale(1)",
        transition:
          "background 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.22s ease, transform 0.12s ease, opacity 0.15s ease",
        flexShrink: 0,
      }}
      onMouseDown={(event) => {
        if (disabled) return;
        (event.currentTarget as HTMLButtonElement).style.transform = "scale(0.94)";
      }}
      onMouseUp={(event) => {
        (event.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
      }}
      onMouseLeave={(event) => {
        (event.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
      }}
      onBlur={(event) => {
        (event.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
      }}
    >
      {on ? "ON" : "OFF"}
    </button>
  );
}
