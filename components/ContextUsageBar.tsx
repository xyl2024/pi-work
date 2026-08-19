"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { SessionStats } from "@/hooks/sessionUiStore";
import { Tooltip } from "./Tooltip";

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

interface Props {
  contextUsage?: ContextUsage | null;
  /**
   * Cumulative session token stats. When provided, the tooltip on the
   * context ring also lists input / output / cache hit rate / cost — the
   * four values that previously lived in a separate `SessionTokenTotals`
   * strip rendered next to the bar. Keeping the strip removed and folding
   * the data into the hover keeps the input bar visually quiet.
   */
  sessionStats?: SessionStats;
}

/**
 * Context usage meter — SVG ring (14×14) sitting in the chat top bar.
 *
 * The track is a faint gray circle; the foreground arc fills up clockwise
 * from 12 o'clock to `percent`% of the circumference, recolored past
 * 30% (yellow) and 70% (red) so the danger signal fires well before the
 * context window is actually full.
 *
 * Sizing notes: the ring is rendered at a fixed 14px on screen, so the
 * stroke is bumped to 2.2 inside the viewBox to stay visible after the
 * default `width / height` down-scale. Numeric label / window readout
 * sits to the right of the ring at 12px tabular-nums so the whole
 * indicator fits in ~75px instead of the previous 10-cell strip's ~90px.
 *
 * Tooltip: full precision percent + window tokens, plus — when
 * `sessionStats` is available — the cumulative input / output / cache-hit
 * rate / cost on separate lines. The cumulative totals are only shown
 * once `useAgentSession` has populated `sessionStats` with at least one
 * assistant `usage` block.
 */
export function ContextUsageBar({ contextUsage, sessionStats }: Props) {
  const { t } = useI18n();
  const { formatCost } = useFormatCurrency();

  const ring = useMemo(() => {
    if (!contextUsage?.contextWindow || contextUsage.percent === null) return null;
    const pct = Math.max(0, Math.min(100, contextUsage.percent));
    // Pick the danger thresholds; using solid colors keeps the ring readable
    // at 14px (a gradient at that size renders as mud).
    const color = pct > 70 ? "#ef4444" : pct > 30 ? "rgba(234,179,8,0.95)" : "var(--accent)";
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

  const contextLine = `${t("Context")}: ${ring.pct.toFixed(1)}% of ${contextUsage!.contextWindow.toLocaleString()} tokens`;

  // Cumulative stats are appended below the context line, only when
  // `useAgentSession` has reported at least one assistant `usage` block.
  // Mirrors `SessionTokenTotals`'s old tooltip layout (one line per stat,
  // cost omitted when 0) so existing muscle memory still works.
  const statsLines = sessionStats
    ? [
        `${t("Input tokens")}: ${sessionStats.tokens.input.toLocaleString()}`,
        `${t("Output tokens")}: ${sessionStats.tokens.output.toLocaleString()}`,
        `${t("Cache hit rate")}: ${((sessionStats.cachedHitRate ?? 0) * 100).toFixed(1)}%`,
        ...(sessionStats.cost !== undefined && sessionStats.cost > 0
          ? [`${t("Cost")}: ${formatCost(sessionStats.cost)}`]
          : []),
      ]
    : [];

  const tooltipText = [contextLine, ...statsLines].join("\n");

  return (
    <Tooltip content={tooltipText}>
      <div
        aria-label={tooltipText}
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
