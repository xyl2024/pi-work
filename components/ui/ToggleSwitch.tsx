"use client";

import * as React from "react";

export interface ToggleSwitchProps {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  size?: "sm" | "md";
}

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
  const travel = width - knob - 4;
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
      onKeyDown={(event) => event.stopPropagation()}
      style={{
        width,
        height,
        borderRadius: height / 2,
        background: on ? "var(--accent)" : "var(--bg-hover)",
        border: "1px solid var(--border)",
        boxSizing: "border-box",
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
