"use client";

import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import { SettingsGroup, SettingsRow } from "../rows";

export function MemorySection({
  config,
  apply,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
}) {
  const { t } = useI18n();
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
    </SettingsGroup>
  );
}
