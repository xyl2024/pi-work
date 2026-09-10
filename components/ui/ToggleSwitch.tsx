"use client";

import * as React from "react";

export interface ToggleSwitchProps {
  /** Whether the switch is in the "on" state. */
  on: boolean;
  /** Receives the next boolean when the user flips the switch. */
  onChange: (next: boolean) => void;
  /** Disables interaction and dims the switch. */
  disabled?: boolean;
  /** Accessible label for screen readers. */
  label?: string;
  /** Visual size. `sm` is for compact rows; `md` (default) matches the settings page. */
  size?: "sm" | "md";
}

/**
 * ToggleSwitch — the app-wide On/Off two-state switch (settings-page style).
 *
 * A single button with role="switch", fully keyboard accessible
 * (Space/Enter toggles). Rendering is a 40×22 sliding-knob pill:
 * accent background + knob on the right when on, muted track + knob
 * on the left when off.
 *
 * Stops click propagation so it can be safely embedded inside
 * clickable list rows / cards without triggering the parent handler.
 */
export function ToggleSwitch({
  on,
  onChange,
  disabled = false,
  label = "Toggle",
  size = "md",
}: ToggleSwitchProps) {
  const isSm = size === "sm";
  const width = isSm ? 32 : 40;
  const height = isSm ? 18 : 22;
  const knob = height - 4;
  const travel = width - knob - 4; // 2px inset on each side
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
        width,
        height,
        borderRadius: height / 2,
        background: on ? "var(--accent)" : "var(--bg-hover)",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        position: "relative",
        opacity: disabled ? 0.55 : 1,
        transition: "background 0.2s",
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? travel + 2 : 2,
          width: knob,
          height: knob,
          borderRadius: knob / 2,
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          transition: "left 0.2s",
        }}
      />
    </button>
  );
}
