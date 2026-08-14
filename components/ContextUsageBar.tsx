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
 * Context usage meter — 10 discrete bars, each covering a 10% bucket. Color
 * thresholds mirror the top-right status bar (>70% yellow, >90% red).
 * Rendered as a slim status strip in the top bar of AppShell, placed to the
 * right of the System Prompts / Tools buttons (left-aligned flow). Moved here
 * from the ChatInput toolbar.
 */
export function ContextUsageBar({ contextUsage }: Props) {
  const { t } = useI18n();

  const contextBar = useMemo(() => {
    if (!contextUsage?.contextWindow || contextUsage.percent === null) return null;
    const pct = Math.max(0, Math.min(100, contextUsage.percent));
    const color = pct > 90 ? "#ef4444" : pct > 70 ? "rgba(234,179,8,0.95)" : "var(--accent)";
    const ctxWindowFmt = contextUsage.contextWindow >= 1_000_000
      ? `${(contextUsage.contextWindow / 1_000_000).toFixed(1)}M`
      : contextUsage.contextWindow >= 1000
        ? `${(contextUsage.contextWindow / 1000).toFixed(0)}k`
        : String(contextUsage.contextWindow);
    // 0% → 0 cells lit; 0.1–10% → 1; 10.1–20% → 2; …; 99.1–100% → 10.
    const filledCells = Math.min(10, Math.ceil(pct / 10));
    return { pct, color, ctxWindowFmt, filledCells };
  }, [contextUsage]);

  if (!contextBar) return null;

  return (
    <Tooltip content={`${t("Context")}: ${contextBar.pct.toFixed(1)}% of ${contextUsage!.contextWindow.toLocaleString()} tokens`}>
      <div
        aria-label={`${t("Context")}: ${contextBar.pct.toFixed(0)}%`}
        style={{
          flexShrink: 0,
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 10px 4px",
          color: contextBar.color,
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        <div
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={contextBar.pct}
          style={{
            display: "flex",
            gap: 2,
            width: 65, height: 8,
            flexShrink: 0,
          }}
        >
          {Array.from({ length: 10 }, (_, i) => {
            const active = i < contextBar.filledCells;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: "100%",
                  background: active ? contextBar.color : "color-mix(in srgb, var(--text-muted) 20%, var(--bg-panel))",
                  borderRadius: 1,
                  transition: "background 0.2s ease",
                }}
              />
            );
          })}
        </div>
        <span style={{ fontWeight: 600 }}>{contextBar.pct.toFixed(0)}%</span>
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>/ {contextBar.ctxWindowFmt}</span>
      </div>
    </Tooltip>
  );
}
