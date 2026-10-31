"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { Field, GroupedSelect } from "../controls";
import type { PiWorkConfig, SuggestedPromptConfig } from "@/lib/shared/config-types";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

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
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/models")
      .then((response) => response.json())
      .then((data: { modelList?: ModelOption[] }) => {
        if (!cancelled) setModels(data.modelList ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const groupedModels = useMemo(() => {
    const groups = new Map<string, ModelOption[]>();
    for (const model of models) {
      const group = groups.get(model.provider) ?? [];
      group.push(model);
      groups.set(model.provider, group);
    }
    return [...groups.entries()];
  }, [models]);

  const modelValue = settings.model
    ? `${settings.model.provider}:${settings.model.modelId}`
    : DEFAULT_MODEL_VALUE;

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
        <Field label={t("Model")}>
          <GroupedSelect
            value={modelValue}
            disabled={models.length === 0}
            leadingOption={{ value: DEFAULT_MODEL_VALUE, label: t("Default model") }}
            groups={groupedModels.map(([provider, providerModels]) => ({
              label: provider,
              options: providerModels.map((model) => ({
                value: `${model.provider}:${model.id}`,
                label: model.name,
              })),
            }))}
            onChange={(value) => {
              if (value === DEFAULT_MODEL_VALUE) {
                update({ model: null });
                return;
              }
              const [provider, ...id] = value.split(":");
              update({ model: { provider, modelId: id.join(":") } });
            }}
          />
        </Field>
      </div>
    </>
  );
}
