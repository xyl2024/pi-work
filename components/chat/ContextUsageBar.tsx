"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { SessionStats } from "@/hooks/sessionUiStore";
import {
  contextUsageSignal,
  formatContextTokensK,
  formatContextWindowCompact,
} from "@/lib/shared/context-usage";
import {
  formatCompositionPercent,
  type ContextBucketId,
  type ContextComposition,
} from "@/lib/shared/context-composition";
import { Tooltip } from "../ui/Tooltip";

/** i18n keys for the composition buckets, one per `ContextBucketId`. `Record`
 *  (not a lookup with a fallback) so adding a bucket to the shared module is a
 *  compile error here instead of an untranslated tooltip line. `messages` uses
 *  the disambiguated key because the plain `Messages` key is the kanban count
 *  label (`消息数`), which would win the dictionary merge. */
const CONTEXT_BUCKET_LABELS: Record<ContextBucketId, string> = {
  "system-prompt": "System prompt",
  "system-tools": "System tool definitions",
  skills: "Skills",
  messages: "Messages (context)",
};

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
  /**
   * Local estimate of what this context window is made of (ADR-0005), anchored
   * to `contextUsage.tokens`. Rendered as one `≈` line per bucket, right under
   * the context line: the total is exact (provider), the split is not (local
   * tokenizer), and the `≈` is the only thing that tells the two apart.
   */
  contextComposition?: ContextComposition | null;
}

/**
 * Context usage meter — SVG ring (14×14) sitting in the chat top bar.
 *
 * The track is a faint gray circle; the foreground arc fills up clockwise
 * from 12 o'clock to `percent`% of the circumference, recolored through the
 * three absolute-size tiers defined in `lib/shared/context-usage` (safe →
 * ≥125k orange → ≥250k red).
 *
 * Sizing notes: the ring is rendered at a fixed 14px on screen, so the
 * stroke is bumped to 2.2 inside the viewBox to stay visible after the
 * default `width / height` down-scale. The label / window readout sits to
 * the right of the ring at 12px tabular-nums so the whole indicator fits
 * in ~75px instead of the previous 10-cell strip's ~90px. The label is the
 * absolute context size in `K` (percent stays tooltip-only) because that is
 * the unit the shared 125k/250k thresholds are expressed in.
 *
 * Tooltip: full precision percent + window tokens, a warning line once the
 * context crosses 125k / 250k, one `≈` line per context-composition bucket
 * (ADR-0005), plus — when `sessionStats` is available — the cumulative input /
 * output / cache-hit rate / cost on separate lines. The cumulative totals are
 * only shown once `useAgentSession` has populated `sessionStats` with at least
 * one assistant `usage` block.
 */
export function ContextUsageBar({ contextUsage, sessionStats, contextComposition }: Props) {
  const { t } = useI18n();
  const { formatCost } = useFormatCurrency();

  const ring = useMemo(() => {
    if (!contextUsage?.contextWindow || contextUsage.percent === null) return null;
    const pct = Math.max(0, Math.min(100, contextUsage.percent));
    // Fall back to a percent-derived estimate so the label still renders if the
    // server ever reports a percent without an absolute token count.
    const tokens =
      contextUsage.tokens ?? Math.round((contextUsage.contextWindow * pct) / 100);
    const signal = contextUsageSignal(tokens);
    // Circle geometry: r=7, stroke sits centered on r, viewBox 0 0 16 16 with
    // 1.5px padding so the 2.2px stroke doesn't clip the box. Circumference
    // 2*PI*7 ≈ 43.98; we shorten the stroke-dasharray to percent% of it.
    const circumference = 2 * Math.PI * 7;
    const dashOffset = circumference * (1 - pct / 100);
    return {
      pct,
      color: signal.color,
      warning: signal.warning,
      circumference,
      dashOffset,
      ctxWindowFmt: formatContextWindowCompact(contextUsage.contextWindow),
      tokensFmt: formatContextTokensK(tokens),
    };
  }, [contextUsage]);

  if (!ring) return null;

  const contextLine = `${t("Context")}: ${ring.pct.toFixed(1)}% of ${contextUsage!.contextWindow.toLocaleString()} tokens`;

  // Cumulative stats are appended below the context line, only when
  // `useAgentSession` has reported at least one assistant `usage` block.
  // Mirrors `SessionTokenTotals`'s old tooltip layout (one line per stat,
  // cost omitted when 0) so existing muscle memory still works.
  const statsLines = sessionStats
    ? [
        t("Input tokens: {count} (excluding cache)", {
          count: sessionStats.tokens.input.toLocaleString(),
        }),
        `${t("Output tokens")}: ${sessionStats.tokens.output.toLocaleString()}`,
        `${t("Cache hit rate")}: ${((sessionStats.cachedHitRate ?? 0) * 100).toFixed(1)}%`,
        ...(sessionStats.cost !== undefined && sessionStats.cost > 0
          ? [`${t("Cost")}: ${formatCost(sessionStats.cost)}`]
          : []),
      ]
    : [];

  // Composition lines sit between the context line and the cumulative stats:
  // they describe *this* prompt, not the session's lifetime spend. Without a
  // provider anchor the bucket has no percentage, so it degrades to the local
  // count alone rather than showing a wrong share of the window.
  const compositionLines = (contextComposition?.buckets ?? []).map((bucket) => {
    const label = t(CONTEXT_BUCKET_LABELS[bucket.id]);
    const tokens = formatContextTokensK(bucket.tokens ?? bucket.localTokens);
    return bucket.percent === null
      ? `${label} ≈ ${tokens}`
      : `${label} ≈ ${tokens} (${formatCompositionPercent(bucket.percent)}%)`;
  });

  // Absolute-size warning line, present only past the 125k / 250k thresholds.
  const warningLines = ring.warning ? [t(ring.warning)] : [];

  const tooltipText = [contextLine, ...warningLines, ...compositionLines, ...statsLines].join("\n");

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
        <span style={{ fontWeight: 600, color: ring.color }}>{ring.tokensFmt}</span>
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>/ {ring.ctxWindowFmt}</span>
      </div>
    </Tooltip>
  );
}
