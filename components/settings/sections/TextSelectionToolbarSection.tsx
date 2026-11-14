"use client";

import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import { SettingsGroup, SettingsRow } from "../rows";

export function TextSelectionToolbarSection({
  config,
  apply,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const enabled = config.text_selection_toolbar.enabled;

  return (
    <SettingsGroup>
      <SettingsRow
        title={t("Text selection toolbar")}
        description={t("Show quick actions next to selected text.")}
      >
        <ToggleSwitch
          on={enabled}
          onChange={(next) => {
            void apply((prev) => ({
              ...prev,
              text_selection_toolbar: { enabled: next },
            }));
          }}
          label={t("Text selection toolbar")}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
