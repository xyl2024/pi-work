"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AnimatedPopover } from "./AnimatedPopover";

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

/**
 * Thinking-level button + upward-anchored dropdown. Owns its own
 * open/hover state and the outside-click dismissal. The picker is
 * hidden entirely while the agent is streaming (the parent renders a
 * read-only badge instead) — the spec is that the level can't be
 * changed mid-turn.
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
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentLevel: ThinkingLevel = thinkingLevel ?? "off";
  const mappedVal = thinkingLevelMap ? thinkingLevelMap[currentLevel] : undefined;
  const currentDisplay = (mappedVal != null && mappedVal !== currentLevel)
    ? mappedVal
    : currentLevel;

  // Only attach the listener while the popover is open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const levelDesc: Record<ThinkingLevel, string> = useMemo(() => ({
    off: t("Disable reasoning"),
    minimal: t("Minimal reasoning"),
    low: t("Low reasoning"),
    medium: t("Medium reasoning"),
    high: t("High reasoning"),
    xhigh: t("Highest reasoning"),
    max: t("Maximum reasoning"),
  }), [t]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={t("Thinking")}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          height: 32, padding: "0 10px",
          background: open || hovered ? "var(--bg-hover)" : "none",
          border: "none", borderRadius: 9,
          color: THINKING_LEVEL_COLOR[currentLevel],
          cursor: "pointer",
          fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
          fontFamily: "var(--font-mono)",
          transition: "background 0.12s, color 0.12s",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
          <line x1="7" y1="18" x2="12" y2="18" />
          <line x1="8" y1="21" x2="11" y2="21" />
        </svg>
        <span>{currentDisplay}</span>
      </button>
      <AnimatedPopover
        open={open}
        style={{
          position: "absolute", bottom: "calc(100% + 6px)", right: 0,
          zIndex: 100, background: "var(--bg-panel)", border: "1px solid var(--border)",
          borderRadius: 10, boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
          minWidth: 180,
        }}
      >
        {THINKING_LEVELS.filter((lvl) => {
          if (!availableThinkingLevels) return true;
          return availableThinkingLevels.includes(lvl);
        }).map((lvl) => {
          const isActive = currentLevel === lvl;
          const mapped = thinkingLevelMap ? thinkingLevelMap[lvl] : undefined;
          const displayLabel = (mapped != null && mapped !== lvl) ? mapped : lvl;
          const showOriginal = mapped != null && mapped !== lvl;
          return (
            <button
              key={lvl}
              onClick={() => { setOpen(false); if (!isActive) onThinkingLevelChange(lvl); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "7px 12px",
                background: isActive ? "var(--bg-selected)" : "none",
                border: "none",
                color: isActive ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer", fontSize: 12, textAlign: "left",
                fontWeight: isActive ? 600 : 400,
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
            >
              {isActive
                ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                : <span style={{ width: 10, flexShrink: 0 }} />}
              <span style={{ flex: 1, color: THINKING_LEVEL_COLOR[lvl] }}>
                {displayLabel}
                {showOriginal && <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>({lvl})</span>}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{levelDesc[lvl]}</span>
            </button>
          );
        })}
      </AnimatedPopover>
    </div>
  );
}
