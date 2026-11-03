"use client";

import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { useSettingsPageData } from "../use-page-data";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import type { MemoryStoreUsage, MemoryUsageReport } from "@/lib/shared/memory";
import { formatMemoryCharCounts } from "@/lib/shared/memory";
import { SecondaryButton } from "../controls";
import type { SettingsPageDataCache } from "@/lib/client/settings-page-cache";

async function loadMemoryUsage(): Promise<MemoryUsageReport> {
  const response = await fetch("/api/memory/usage");
  const data = (await response.json().catch(() => ({}))) as
    & Partial<MemoryUsageReport>
    & { error?: string };
  if (!response.ok || data.error || !data.memory || !data.user) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return { memory: data.memory, user: data.user };
}

function usageText(usage: MemoryStoreUsage | undefined): string {
  if (!usage || usage.status === "unreadable") return "—";
  return formatMemoryCharCounts(usage.used, usage.limit);
}

function MemoryUsageRow({
  file,
  usage,
}: {
  file: string;
  usage: MemoryStoreUsage | undefined;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 0",
        borderTop: "1px solid var(--border)",
      }}
    >
      <span style={{ fontSize: 13, color: "var(--text)" }}>{file}</span>
      <span style={{ fontSize: 13, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
        {usageText(usage)}
      </span>
    </div>
  );
}

export function MemorySection({
  config,
  apply,
  pageCache,
  onOpenMemoryPanel,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
  pageCache: SettingsPageDataCache;
  onOpenMemoryPanel?: () => void;
}) {
  const { t } = useI18n();
  const { data: usage } = useSettingsPageData(pageCache, "memory", loadMemoryUsage);
  const enabled = config.memory.enabled;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 13, color: "var(--text)" }}>
          {enabled ? t("Memory on") : t("Memory off")}
        </span>
        <ToggleSwitch
          on={enabled}
          onChange={(next) => {
            void apply((prev) => ({ ...prev, memory: { enabled: next } }));
          }}
          label={t("Memory")}
        />
      </div>
      <div style={{ marginTop: 12 }}>
        <MemoryUsageRow file="MEMORY.md" usage={usage?.memory} />
        <MemoryUsageRow file="USER.md" usage={usage?.user} />
      </div>
      {onOpenMemoryPanel && (
        <div style={{ marginTop: 12 }}>
          <SecondaryButton onClick={onOpenMemoryPanel}>{t("View entries")}</SecondaryButton>
        </div>
      )}
    </>
  );
}
