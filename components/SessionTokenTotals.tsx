"use client";

import { useMemo } from "react";
import { useSessionUiState } from "@/hooks/sessionUiStore";
import { useI18n } from "@/hooks/useI18n";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { Tooltip } from "./Tooltip";

/**
 * Compact one-liner showing the cumulative token + cost totals for the
 * active leaf path of the current session. Rendered alongside
 * `ContextUsageBar` in the chat top bar (see `components/AppShell.tsx`).
 *
 * Source of truth is `sessionStats` in `sessionUiStore`, which is filled
 * by `useAgentSession` once any assistant message has produced a usage
 * block. Until then the whole strip is hidden — empty state is no strip.
 *
 * - input / output are summed across all assistant messages in the leaf
 *   path (matches what every per-message hover label already shows, just
 *   aggregated).
 * - cached% is **weighted** (Σ cacheRead / Σ (input + cacheRead)) — a
 *   simple arithmetic mean would skew toward the noisy tail; see the
 *   sessionStats IIFE for the rationale.
 * - cost is omitted entirely when 0, to avoid a dangling "$0.0000" on
 *   models without pricing configured.
 *
 * Updates on each `message_end` — not during streaming — so the strip
 * stays visually stable while tokens are still flowing in.
 */
export function SessionTokenTotals() {
  const { t } = useI18n();
  const stats = useSessionUiState().sessionStats;
  const { formatCost } = useFormatCurrency();

  const formatted = useMemo(() => {
    if (!stats) return null;
    const inFmt = stats.tokens.input.toLocaleString();
    const outFmt = stats.tokens.output.toLocaleString();
    // cached% is undefined until the denominator is meaningful; render
    // "0.0% cached" for providers that never report caching.
    const hitPct = ((stats.cachedHitRate ?? 0) * 100).toFixed(1);
    const parts = [`${inFmt} ${t("in")}`, `${outFmt} ${t("out")}`, `${hitPct}% ${t("cache")}`];
    if (stats.cost && stats.cost > 0) {
      parts.push(formatCost(stats.cost));
    }
    return parts;
  }, [stats, t, formatCost]);

  if (!formatted) return null;

  const [inStr, outStr, cacheStr, costStr] = formatted;
  const tooltipText = [inStr, outStr, cacheStr, costStr].filter(Boolean).join(" · ");

  return (
    <Tooltip content={tooltipText}>
      <div
        aria-label={tooltipText}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px 4px",
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          color: "var(--text)",
        }}
      >
        <span style={{ color: "var(--text-dim)" }}>{inStr}</span>
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>·</span>
        <span style={{ color: "var(--text-dim)" }}>{outStr}</span>
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>·</span>
        <span style={{ color: "var(--text-dim)" }}>{cacheStr}</span>
        {costStr && (
          <>
            <span style={{ color: "var(--text-dim)", fontSize: 11 }}>·</span>
            <span style={{ color: "var(--accent)" }}>{costStr}</span>
          </>
        )}
      </div>
    </Tooltip>
  );
}
