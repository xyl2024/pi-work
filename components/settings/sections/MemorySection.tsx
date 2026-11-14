"use client";

import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { useSettingsPageData } from "../use-page-data";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import type { MemoryStoreUsage, MemoryUsageReport } from "@/lib/shared/memory";
import { formatMemoryCharCounts } from "@/lib/shared/memory";
import { SecondaryButton } from "../controls";
import { SettingsGroup, SettingsRow } from "../rows";
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
  title,
  file,
  usage,
}: {
  title: string;
  file: string;
  usage: MemoryStoreUsage | undefined;
}) {
  return (
    <SettingsRow
      title={title}
      description={<span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{file}</span>}
    >
      <span style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
        {usageText(usage)}
      </span>
    </SettingsRow>
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
    <SettingsGroup>
      <SettingsRow
        title={t("Memory")}
        description={t("Let the agent keep notes about you and your work across sessions.")}
      >
        <ToggleSwitch
          on={enabled}
          onChange={(next) => {
            void apply((prev) => ({ ...prev, memory: { enabled: next } }));
          }}
          label={t("Memory")}
        />
      </SettingsRow>
      <MemoryUsageRow title={t("Agent notes")} file="MEMORY.md" usage={usage?.memory} />
      <MemoryUsageRow title={t("User profile")} file="USER.md" usage={usage?.user} />
      {onOpenMemoryPanel && (
        <div style={{ marginTop: 14 }}>
          <SecondaryButton onClick={onOpenMemoryPanel}>{t("View entries")}</SecondaryButton>
        </div>
      )}
    </SettingsGroup>
  );
}
