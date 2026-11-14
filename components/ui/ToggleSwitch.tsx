"use client";

import * as React from "react";
import styles from "./ToggleSwitch.module.css";

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
  const knob = height - 6;
  const travel = width - knob - 6;
  const trackStyle = { width, height };
  const knobStyle = { width: knob, height: knob };
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
      className={[styles.track, on ? styles.on : ""].filter(Boolean).join(" ")}
      style={{ ...trackStyle, "--knob-travel": `${travel}px` } as React.CSSProperties}
    >
      <span className={styles.knob} style={knobStyle} />
    </button>
  );
}
