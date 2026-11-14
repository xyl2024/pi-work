"use client";

import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { ModelSelect } from "../ModelSelect";
import { SettingsGroup, SettingsRow } from "../rows";
import type { PiWorkConfig, SuggestedPromptConfig } from "@/lib/shared/config-types";

const DEFAULT_MODEL_VALUE = "default";

export function SuggestedPromptSection({
  config,
  apply,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const settings = config.suggested_prompt;

  const update = (patch: Partial<SuggestedPromptConfig>) => {
    void apply((prev) => ({
      ...prev,
      suggested_prompt: {
        enabled: prev.suggested_prompt.enabled,
        model: prev.suggested_prompt.model,
        ...patch,
      },
    }));
  };

  return (
    <SettingsGroup>
      <SettingsRow
        title={t("Enable suggested prompts")}
        description={t("Offer follow-up questions after each reply.")}
      >
        <ToggleSwitch
          on={settings.enabled}
          onChange={(next) => update({ enabled: next })}
          label={t("Enable suggested prompts")}
        />
      </SettingsRow>
      <SettingsRow title={t("Model")}>
        <ModelSelect
          value={settings.model}
          leadingOption={{ value: DEFAULT_MODEL_VALUE, label: t("Default model") }}
          onChange={(model) => update({ model })}
          width={220}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
