"use client";

import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import { SettingsGroup, SettingsRow } from "../rows";

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
    <SettingsGroup>
      <SettingsRow
        title={t("Sidebar entry")}
        description={t("Show the assistant entry in the sidebar.")}
      >
        <ToggleSwitch
          on={shown}
          onChange={(next) => {
            void apply((prev) => ({ ...prev, assistant: { sidebar_entry: next } }));
          }}
          label={t("Sidebar entry")}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
