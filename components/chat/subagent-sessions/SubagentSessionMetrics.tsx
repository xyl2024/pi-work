"use client";

import { useI18n } from "@/hooks/useI18n";
import { ProviderIcon, resolveProviderIcon } from "@/components/ui/ProviderIcon";
import { formatTps, formatTtft } from "@/lib/shared/model-call-metrics";
import type { SubagentSessionStatsView } from "@/lib/shared/types";

export interface SubagentSessionMetricsProps {
  stats: SubagentSessionStatsView | null;
}

function formatCount(count: number | null | undefined): string {
  return count === null || count === undefined ? "—" : String(count);
}

function formatMetric(value: number | null | undefined, format: (value: number) => string): string {
  return value === null || value === undefined ? "—" : format(value);
}

export function SubagentSessionMetrics({ stats }: SubagentSessionMetricsProps) {
  const { t } = useI18n();
  const model = stats?.model ?? null;
  const iconId = model ? resolveProviderIcon(model.provider, model.modelId) : undefined;
  const items = [
    { key: "messages", label: t("Messages"), value: formatCount(stats?.assistantCount) },
    { key: "toolCalls", label: t("Tool calls"), value: formatCount(stats?.toolCallCount) },
    { key: "ttft", label: t("Avg TTFT"), value: formatMetric(stats?.avgTtftMs, formatTtft) },
    { key: "tps", label: t("Avg TPS"), value: formatMetric(stats?.avgGenerationTps, formatTps) },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "2px 10px",
        marginTop: 6,
        fontSize: 10,
        lineHeight: 1.6,
        color: "var(--text-muted)",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0, color: "var(--text)" }}>
        {model?.modelId ? (
          <>
            <ProviderIcon id={iconId ?? ""} size={12} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model.modelId}</span>
          </>
        ) : (
          <span>—</span>
        )}
      </span>
      {items.map((item) => (
        <span key={item.key} style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}>
          <span>{item.label}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{item.value}</span>
        </span>
      ))}
    </div>
  );
}
