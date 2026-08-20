"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

/** All thinking-intensity levels, in display order. The literal union
 *  here is also the source of the `ThinkingLevel` type aliases used by
 *  ChatInput's source-of-truth state and the `THINKING_LEVEL_COLOR` /
 *  `THINKING_BORDER_COLOR` keys. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = typeof THINKING_LEVELS[number];

/** Solid (opaque) palette — same hues as the input border gradient,
 *  used to paint the per-level indicator inside the picker so each
 *  option is visually tied to the color the input border adopts when
 *  picked. Exported so ChatInput can colour the streaming badge the
 *  same way. */
export const THINKING_LEVEL_COLOR: Record<ThinkingLevel, string> = {
  off: "#94a3b8",      // slate-400
  minimal: "#38bdf8",  // sky-400
  low: "#3b82f6",      // blue-500
  medium: "#8b5cf6",   // violet-500
  high: "#f97316",     // orange-500
  xhigh: "#ef4444",    // red-500
  max: "#b91c1c",      // red-700
};

/** Minimum gap between two wheel-driven cycles. Wheel events fire in
 *  bursts (one scroll tick can dispatch a dozen events); without a
 *  throttle a single flick would catapult the user from `off` to
 *  `max`. 150 ms is enough to see the colour/label transition between
 *  steps without feeling sluggish on a deliberate scroll. */
const WHEEL_THROTTLE_MS = 150;

/**
 * Thinking-level cycling button. Click or scroll-wheel cycles through
 * the levels the current model actually supports, looping seamlessly.
 * Replaces the previous click-to-open popover design — that surface
 *  was redundant with the colour gradient the input border already
 *  wears, and required two interactions for what is fundamentally a
 *  one-knob setting.
 *
 * The picker is hidden entirely while the agent is streaming (the
 * parent renders a read-only badge instead) — the spec is that the
 * level can't be changed mid-turn.
 */
export function ThinkingPicker({
  thinkingLevel,
  onThinkingLevelChange,
  availableThinkingLevels,
  thinkingLevelMap,
}: {
  thinkingLevel: ThinkingLevel | undefined;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
}) {
  const { t } = useI18n();

  const currentLevel: ThinkingLevel = thinkingLevel ?? "off";
  const mappedVal = thinkingLevelMap ? thinkingLevelMap[currentLevel] : undefined;
  const currentDisplay = (mappedVal != null && mappedVal !== currentLevel)
    ? mappedVal
    : currentLevel;

  // Levels the current model actually supports — the cycle is confined
  // to these so the button's visible label never disagrees with the
  // level the backend ends up on after `pickClosestAvailableThinkingLevel`
  // (lib/shared/thinking-level-utils.ts).
  const availableLevels = useMemo<readonly ThinkingLevel[]>(
    () => THINKING_LEVELS.filter((lvl) =>
      availableThinkingLevels ? availableThinkingLevels.includes(lvl) : true
    ),
    [availableThinkingLevels],
  );

  const cycleTo = (direction: 1 | -1) => {
    if (availableLevels.length === 0) return;
    const idx = availableLevels.indexOf(currentLevel);
    // `idx === -1` covers the transient state right after the user
    // switched to a model that doesn't support the previous pick —
    // fall through to the first available level so the button still
    // reflects something real.
    const nextIdx = ((idx + direction) % availableLevels.length + availableLevels.length) % availableLevels.length;
    const nextLevel = availableLevels[nextIdx];
    if (nextLevel !== currentLevel) onThinkingLevelChange(nextLevel);
  };

  // Wheel throttle — see WHEEL_THROTTLE_MS for the rationale. We
  // `stopPropagation` so the wheel tick doesn't bubble up to a parent
  // scroll container (e.g. the message list); we deliberately do NOT
  // `preventDefault` because nothing in the toolbar actually scrolls.
  const wheelLockRef = useRef(false);
  const handleWheel = (e: React.WheelEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (wheelLockRef.current) return;
    const direction: 1 | -1 = e.deltaY > 0 ? 1 : -1;
    cycleTo(direction);
    wheelLockRef.current = true;
    window.setTimeout(() => { wheelLockRef.current = false; }, WHEEL_THROTTLE_MS);
  };

  // Bump `animKey` whenever the displayed label actually changes so the
  // label span remounts and its fade-in animation re-runs. Keeping
  // the effect purely prop-driven means there is no internal
  // "optimistic" state to reconcile if the parent rejects the cycle.
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
        display: "inline-flex", alignItems: "center", gap: 6,
        height: 32, padding: "0 10px",
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
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
        <line x1="7" y1="18" x2="12" y2="18" />
        <line x1="8" y1="21" x2="11" y2="21" />
      </svg>
      <span key={animKey} className="thinking-picker-label">
        {currentDisplay}
      </span>
    </button>
  );
}
