"use client";

import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { ModelSelect } from "../ModelSelect";
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
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: "var(--text)" }}>
          {t("Enable suggested prompts")}
        </span>
        <ToggleSwitch
          on={settings.enabled}
          onChange={(next) => update({ enabled: next })}
          label={t("Enable suggested prompts")}
        />
      </div>

      <div style={{ maxWidth: 320 }}>
        <ModelSelect
          label={t("Model")}
          value={settings.model}
          leadingOption={{ value: DEFAULT_MODEL_VALUE, label: t("Default model") }}
          onChange={(model) => update({ model })}
        />
      </div>
    </>
  );
}
