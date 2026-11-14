"use client";

import { useI18n } from "@/hooks/useI18n";
import { formatContextTokensK, formatContextWindowCompact } from "@/lib/shared/context-usage";
import type { SubagentSessionContextUsage } from "@/lib/shared/types";
import { Tooltip } from "@/components/ui/Tooltip";

export interface SubagentSessionContextRingProps {
  context: SubagentSessionContextUsage | null;
}

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SIZE = 16;

function formatPercent(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  return `${clamped < 10 ? clamped.toFixed(1) : clamped.toFixed(0)}%`;
}

export function SubagentSessionContextRing({ context }: SubagentSessionContextRingProps) {
  const { t } = useI18n();
  const tokens = context?.tokens ?? null;
  const rawPercent = context?.percent ?? null;
  const known = tokens !== null && rawPercent !== null;
  const percent = known ? Math.max(0, Math.min(100, rawPercent)) : 0;
  const windowText = context ? formatContextWindowCompact(context.contextWindow) : null;

  const unknownTooltipLine = context?.stale
    ? t("Compacted; waiting for the next assistant reply")
    : t("No context data available");

  const tooltipLines = !context
    ? [`${t("Context")}: ${t("Unknown")}`, t("No context data available")]
    : known
      ? [
          `${t("Context")}: ${formatContextTokensK(tokens)} / ${windowText} (${formatPercent(percent)})`,
          `${tokens.toLocaleString()} / ${context.contextWindow.toLocaleString()} tokens`,
          ...(context.live ? [] : [t("Last recorded value")]),
        ]
      : [
          `${t("Context")}: ${t("Unknown")} / ${windowText}`,
          unknownTooltipLine,
        ];

  const valueText = known
    ? `${formatPercent(percent)} · ${formatContextTokensK(tokens)} / ${windowText}`
    : "—";
  const ringColor = known ? "var(--accent)" : "var(--text-muted)";

  return (
    <Tooltip content={tooltipLines.join("\n")} side="top">
      <div
        aria-label={tooltipLines.join(" · ")}
        role={known ? "meter" : "img"}
        aria-valuemin={known ? 0 : undefined}
        aria-valuemax={known ? 100 : undefined}
        aria-valuenow={known ? percent : undefined}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          color: known ? "var(--text)" : "var(--text-muted)",
          fontSize: 10,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" style={{ flexShrink: 0, overflow: "visible" }}>
          <circle
            cx="8"
            cy="8"
            r={RADIUS}
            fill="none"
            stroke="color-mix(in srgb, var(--text-muted) 25%, var(--bg-panel))"
            strokeWidth="2.2"
          />
          <circle
            cx="8"
            cy="8"
            r={RADIUS}
            fill="none"
            stroke={ringColor}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
            transform="rotate(-90 8 8)"
            style={{ transition: "stroke-dashoffset var(--dur-slow) var(--ease-standard), stroke var(--dur-base) var(--ease-standard)" }}
          />
        </svg>
        <span style={{ fontWeight: 600 }}>{valueText}</span>
      </div>
    </Tooltip>
  );
}
