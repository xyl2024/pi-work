"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  formatEstimatedTokens,
  type ContextComposition,
} from "@/lib/shared/context-composition";
import { Tooltip } from "../ui/Tooltip";
import { useToolCallScroll } from "@/hooks/toolCallScrollStore";
import { ContextCompositionPopover } from "./ContextCompositionPopover";
import { CONTEXT_BUCKET_LABELS } from "./context-composition-label";

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

interface Props {
  contextUsage?: ContextUsage | null;
  sessionStats?: SessionStats;
  contextComposition?: ContextComposition | null;
  compact?: boolean;
}

export function ContextUsageBar({ contextUsage, sessionStats, contextComposition, compact = false }: Props) {
  const { t } = useI18n();
  const { formatCost } = useFormatCurrency();

  const ring = useMemo(() => {
    if (!contextUsage?.contextWindow || contextUsage.percent === null) return null;
    const pct = Math.max(0, Math.min(100, contextUsage.percent));
    const tokens =
      contextUsage.tokens ?? Math.round((contextUsage.contextWindow * pct) / 100);
    const signal = contextUsageSignal(tokens);
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

  const [compositionOpen, setCompositionOpen] = useState(false);
  const [popoverMaxHeight, setPopoverMaxHeight] = useState<number | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const canOpenComposition = !!contextComposition;
  const jumpToToolCall = useToolCallScroll();

  useEffect(() => {
    if (!compositionOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) setCompositionOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCompositionOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [compositionOpen]);

  useEffect(() => {
    if (!compositionOpen) return;
    const top = anchorRef.current?.getBoundingClientRect().top;
    if (top === undefined) return;
    setPopoverMaxHeight(Math.max(1, Math.round(top - 12)));
  }, [compositionOpen]);

  if (!ring) return null;

  const contextLine = `${t("Context")}: ${ring.pct.toFixed(1)}% of ${contextUsage!.contextWindow.toLocaleString()} tokens`;

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

  const compositionLines = (contextComposition?.buckets ?? []).map((bucket) => {
    const label = t(CONTEXT_BUCKET_LABELS[bucket.id]);
    const tokens = formatEstimatedTokens(bucket.tokens ?? bucket.localTokens);
    return bucket.percent === null
      ? `${label} ${tokens}`
      : `${label} ${tokens} (${formatCompositionPercent(bucket.percent)}%)`;
  });

  const warningLines = ring.warning ? [t(ring.warning)] : [];

  const tooltipText = [contextLine, ...warningLines, ...compositionLines, ...statsLines].join("\n");

  const indicatorStyle: CSSProperties = {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: compact ? 0 : 6,
    padding: compact ? "6px 4px 4px" : "6px 10px 4px",
    color: "var(--text)",
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  };

  const indicator = (
    <>
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
        <circle
          cx="8" cy="8" r="7"
          fill="none"
          stroke="color-mix(in srgb, var(--text-muted) 25%, var(--bg-panel))"
          strokeWidth="2.2"
        />
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
      {!compact && (
        <>
          <span style={{ fontWeight: 600, color: ring.color }}>{ring.tokensFmt}</span>
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>/ {ring.ctxWindowFmt}</span>
        </>
      )}
    </>
  );

  return (
    <div ref={anchorRef} style={{ position: "relative", flexShrink: 0 }}>
      <Tooltip content={tooltipText} open={compositionOpen ? false : undefined}>
        {canOpenComposition ? (
          <button
            type="button"
            onClick={() => setCompositionOpen((open) => !open)}
            aria-label={tooltipText}
            aria-haspopup="dialog"
            aria-expanded={compositionOpen}
            style={{ ...indicatorStyle, background: "none", border: "none", cursor: "pointer", font: "inherit", fontSize: 12, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
          >
            {indicator}
          </button>
        ) : (
          <div aria-label={tooltipText} style={indicatorStyle}>
            {indicator}
          </div>
        )}
      </Tooltip>
      {compositionOpen && contextComposition && (
        <ContextCompositionPopover
          composition={contextComposition}
          contextWindow={contextUsage!.contextWindow}
          fallbackTotalTokens={contextUsage!.tokens}
          maxHeight={popoverMaxHeight}
          onJumpToToolCall={jumpToToolCall}
        />
      )}
    </div>
  );
}
