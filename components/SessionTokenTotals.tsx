"use client";

import { useMemo } from "react";
import { useSessionUiState } from "@/hooks/sessionUiStore";
import { useI18n } from "@/hooks/useI18n";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { Tooltip } from "./Tooltip";

/**
 * Compact stats strip for the chat top bar.
 *
 * Shown only once `useAgentSession` has populated `sessionStats` with at
 * least one assistant `usage` block. Each stat is rendered as a tiny
 * icon (10×10 stroke) + compact-rounded number; `cost` keeps its full
 * currency-formatted text since `formatCost` already prefixes the
 * `$`/`¥` symbol.
 *
 * Layout: in · out · cache% · cost, separated by `·` to keep a single
 * inline line. All short numbers round to 2 significant figures
 * (see `compactNumber`); the full-precision values live in the tooltip
 * with translated labels so the cursor-on-hover crowd still gets exact
 * counts.
 *
 * - `cachedHitRate` is weighted across the active leaf path
 *   (Σ cacheRead / Σ (input + cacheRead)); 0% is rendered as "0%" rather
 *   than hidden so the strip stays a stable width when a provider
 *   doesn't report caching.
 * - `cost` is omitted entirely when 0 — the whole `.cost` segment hides,
 *   so models without pricing don't leave a dangling "$0".
 *
 * Updates on each `message_end` (not during streaming) so the strip
 * stays visually stable while tokens are still flowing in.
 */
function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 1_000) {
    const v = n / 1_000;
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}

const ICON_SIZE = 10;
const ICON_STROKE = 1.6;

function ArrowDown() {
  // downward arrow = tokens flowing IN to the context window
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="6 13 12 19 18 13" />
    </svg>
  );
}

function ArrowUp() {
  // upward arrow = tokens flowing OUT of the context window
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </svg>
  );
}

function Refresh() {
  // circular arrow = cached prompt reuse
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M21 12a9 9 0 1 1-3.5-7.1" />
      <polyline points="21 4 21 10 15 10" />
    </svg>
  );
}

export function SessionTokenTotals() {
  const { t } = useI18n();
  const stats = useSessionUiState().sessionStats;
  const { formatCost } = useFormatCurrency();

  const formatted = useMemo(() => {
    if (!stats) return null;
    const inShort = compactNumber(stats.tokens.input);
    const outShort = compactNumber(stats.tokens.output);
    const cachePct = ((stats.cachedHitRate ?? 0) * 100).toFixed(0);
    return {
      inShort, outShort, cachePct,
      hasCost: stats.cost !== undefined && stats.cost > 0,
      costShort: stats.cost && stats.cost > 0 ? formatCost(stats.cost) : "",
    };
  }, [stats, formatCost]);

  if (!formatted) return null;

  // Tooltip: full precision. Lines instead of separators so each label is
  // right-aligned-translatable without layout shifting.
  const tooltipText = [
    `${t("Input tokens")}: ${stats!.tokens.input.toLocaleString()}`,
    `${t("Output tokens")}: ${stats!.tokens.output.toLocaleString()}`,
    `${t("Cache hit rate")}: ${((stats!.cachedHitRate ?? 0) * 100).toFixed(1)}%`,
  ].concat(formatted.hasCost ? [`${t("Cost")}: ${formatted.costShort}`] : []).join("\n");

  const sep = <span style={{ color: "var(--text-dim)", fontSize: 11 }}>·</span>;

  return (
    <Tooltip content={tooltipText}>
      <div
        aria-label={tooltipText}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px 4px",
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          color: "var(--text-muted)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
          <ArrowDown />
          {formatted.inShort}
        </span>
        {sep}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
          <ArrowUp />
          {formatted.outShort}
        </span>
        {sep}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
          <Refresh />
          {formatted.cachePct}%
        </span>
        {formatted.hasCost && (
          <>
            {sep}
            <span style={{ color: "var(--accent)", fontWeight: 500 }}>{formatted.costShort}</span>
          </>
        )}
      </div>
    </Tooltip>
  );
}
