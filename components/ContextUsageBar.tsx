"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "./Tooltip";

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

interface Props {
  contextUsage?: ContextUsage | null;
}

/**
 * Context usage meter — SVG ring (14×14) sitting in the chat top bar.
 *
 * The track is a faint gray circle; the foreground arc fills up clockwise
 * from 12 o'clock to `percent`% of the circumference, recolored past
 * 70% (yellow) and 90% (red) to mirror the old 10-cell strip's danger
 * thresholds.
 *
 * Sizing notes: the ring is rendered at a fixed 14px on screen, so the
 * stroke is bumped to 2.2 inside the viewBox to stay visible after the
 * default `width / height` down-scale. Numeric label / window readout
 * sits to the right of the ring at 12px tabular-nums so the whole
 * indicator fits in ~75px instead of the previous 10-cell strip's ~90px.
 *
 * Tooltip stays unchanged: full precision percent + window tokens.
 */
export function ContextUsageBar({ contextUsage }: Props) {
  const { t } = useI18n();

  const ring = useMemo(() => {
    if (!contextUsage?.contextWindow || contextUsage.percent === null) return null;
    const pct = Math.max(0, Math.min(100, contextUsage.percent));
    // Pick the same danger thresholds as the old bar; using solid colors keeps
    // the ring readable at 14px (a gradient at that size renders as mud).
    const color = pct > 90 ? "#ef4444" : pct > 70 ? "rgba(234,179,8,0.95)" : "var(--accent)";
    // Circle geometry: r=7, stroke sits centered on r, viewBox 0 0 16 16 with
    // 1.5px padding so the 2.2px stroke doesn't clip the box. Circumference
    // 2*PI*7 ≈ 43.98; we shorten the stroke-dasharray to percent% of it.
    const circumference = 2 * Math.PI * 7;
    const dashOffset = circumference * (1 - pct / 100);
    const ctxWindowFmt = contextUsage.contextWindow >= 1_000_000
      ? `${(contextUsage.contextWindow / 1_000_000).toFixed(1)}M`
      : contextUsage.contextWindow >= 1000
        ? `${(contextUsage.contextWindow / 1000).toFixed(0)}k`
        : String(contextUsage.contextWindow);
    return { pct, color, circumference, dashOffset, ctxWindowFmt };
  }, [contextUsage]);

  if (!ring) return null;

  const tooltipText = `${t("Context")}: ${ring.pct.toFixed(1)}% of ${contextUsage!.contextWindow.toLocaleString()} tokens`;

  return (
    <Tooltip content={tooltipText}>
      <div
        aria-label={`${t("Context")}: ${ring.pct.toFixed(0)}%`}
        style={{
          flexShrink: 0,
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 10px 4px",
          color: "var(--text)",
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={ring.pct}
          style={{ flexShrink: 0, overflow: "visible" }}
        >
          {/* track */}
          <circle
            cx="8" cy="8" r="7"
            fill="none"
            stroke="color-mix(in srgb, var(--text-muted) 25%, var(--bg-panel))"
            strokeWidth="2.2"
          />
          {/* foreground arc — rotated -90° so progress starts at 12 o'clock */}
          <circle
            cx="8" cy="8" r="7"
            fill="none"
            stroke={ring.color}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeDasharray={ring.circumference}
            strokeDashoffset={ring.dashOffset}
            transform="rotate(-90 8 8)"
            style={{ transition: "stroke-dashoffset 0.25s ease, stroke 0.2s ease" }}
          />
        </svg>
        <span style={{ fontWeight: 600, color: ring.color }}>{ring.pct.toFixed(0)}%</span>
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>/ {ring.ctxWindowFmt}</span>
      </div>
    </Tooltip>
  );
}
