"use client";

import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import type { PiWorkConfig } from "@/lib/shared/config-types";

export function AssistantSection({
  config,
  apply,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const shown = config.assistant.sidebar_entry;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 13, color: "var(--text)" }}>{t("Sidebar entry")}</span>
      <ToggleSwitch
        on={shown}
        onChange={(next) => {
          void apply((prev) => ({ ...prev, assistant: { sidebar_entry: next } }));
        }}
        label={t("Sidebar entry")}
      />
    </div>
  );
}
