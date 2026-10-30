"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = typeof THINKING_LEVELS[number];

export const THINKING_LEVEL_COLOR: Record<ThinkingLevel, string> = {
  off: "#94a3b8",
  minimal: "#38bdf8",
  low: "#3b82f6",
  medium: "#8b5cf6",
  high: "#f97316",
  xhigh: "#ef4444",
  max: "#b91c1c",
};

const WHEEL_THROTTLE_MS = 150;

export function ThinkingIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
      <line x1="7" y1="18" x2="12" y2="18" />
      <line x1="8" y1="21" x2="11" y2="21" />
    </svg>
  );
}

export function nextThinkingLevel(
  current: ThinkingLevel,
  available: readonly ThinkingLevel[],
  direction: 1 | -1 = 1,
): ThinkingLevel | null {
  if (available.length === 0) return null;
  const idx = available.indexOf(current);
  const nextIdx = ((idx + direction) % available.length + available.length) % available.length;
  const next = available[nextIdx];
  return next === current ? null : next;
}

export function availableThinkingLevelsOf(
  available: readonly string[] | null | undefined,
): ThinkingLevel[] {
  return THINKING_LEVELS.filter((lvl) => (available ? available.includes(lvl) : true));
}

export function ThinkingPicker({
  thinkingLevel,
  onThinkingLevelChange,
  availableThinkingLevels,
  thinkingLevelMap,
  labelVisible = true,
}: {
  thinkingLevel: ThinkingLevel | undefined;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  labelVisible?: boolean;
}) {
  const { t } = useI18n();

  const currentLevel: ThinkingLevel = thinkingLevel ?? "off";
  const mappedVal = thinkingLevelMap ? thinkingLevelMap[currentLevel] : undefined;
  const currentDisplay = (mappedVal != null && mappedVal !== currentLevel)
    ? mappedVal
    : currentLevel;

  const availableLevels = useMemo<readonly ThinkingLevel[]>(
    () => availableThinkingLevelsOf(availableThinkingLevels),
    [availableThinkingLevels],
  );

  const cycleTo = (direction: 1 | -1) => {
    const next = nextThinkingLevel(currentLevel, availableLevels, direction);
    if (next) onThinkingLevelChange(next);
  };

  const wheelLockRef = useRef(false);
  const handleWheel = (e: React.WheelEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (wheelLockRef.current) return;
    const direction: 1 | -1 = e.deltaY > 0 ? 1 : -1;
    cycleTo(direction);
    wheelLockRef.current = true;
    window.setTimeout(() => { wheelLockRef.current = false; }, WHEEL_THROTTLE_MS);
  };

  const [animKey, setAnimKey] = useState(0);
  const lastDisplayRef = useRef(currentDisplay);
  useEffect(() => {
    if (lastDisplayRef.current !== currentDisplay) {
      lastDisplayRef.current = currentDisplay;
      setAnimKey((k) => k + 1);
    }
  }, [currentDisplay]);

  return (
    <button
      type="button"
      onClick={() => cycleTo(1)}
      onWheel={handleWheel}
      aria-label={t("Thinking level: {level}. Click or scroll to cycle.", { level: currentDisplay })}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        height: 32, padding: labelVisible ? "0 10px" : 0, flexShrink: 0,
        width: labelVisible ? undefined : 32,
        background: "none",
        border: "none", borderRadius: 9,
        color: THINKING_LEVEL_COLOR[currentLevel],
        cursor: "pointer",
        fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
        fontFamily: "var(--font-mono)",
        transition: "background 0.12s, color 0.12s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
    >
      <ThinkingIcon />
      {labelVisible && (
        <span key={animKey} className="thinking-picker-label">
          {currentDisplay}
        </span>
      )}
    </button>
  );
}
