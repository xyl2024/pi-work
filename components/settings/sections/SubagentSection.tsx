"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { THINKING_LEVELS, type ThinkingLevel } from "@/components/chat/ThinkingPicker";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import { SettingsSection } from "../SettingsSection";
import { GroupedSelect, Select } from "../controls";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

const MODEL_SELECT_STYLE: React.CSSProperties = { flex: 1, maxWidth: 360 };

export function SubagentSection({
  config,
  apply,
}: {
  config: PiWorkConfig | null;
  apply: (compute: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/models")
      .then((r) => r.json())
      .then((data: { modelList?: ModelOption[] }) => {
        if (!cancelled) setModels(data.modelList ?? []);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
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

  if (!config) return null;
  const selectedModel = config.subagent.model
    ? `${config.subagent.model.provider}:${config.subagent.model.modelId}`
    : "inherit";

  return (
    <SettingsSection id="subagent" topGap>
      <h3 style={{ margin: 0, fontSize: 15 }}>{t("Subagent settings")}</h3>
      <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
        {t("Configure the model and thinking level used by new subagent sessions.")}
      </p>

      <label style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, fontSize: 13 }}>
        <span style={{ minWidth: 150 }}>{t("Subagent model")}</span>
        <GroupedSelect
          value={selectedModel}
          style={MODEL_SELECT_STYLE}
          disabled={models.length === 0}
          leadingOption={{ value: "inherit", label: t("Inherit parent model") }}
          groups={groupedModels.map(([provider, providerModels]) => ({
            label: provider,
            options: providerModels.map((model) => ({
              value: `${model.provider}:${model.id}`,
              label: model.name,
            })),
          }))}
          onChange={(value) => {
            void apply((prev) => ({
              ...prev,
              subagent: {
                ...prev.subagent,
                model: value === "inherit" ? undefined : (() => {
                  const [provider, ...id] = value.split(":");
                  return { provider, modelId: id.join(":") };
                })(),
              },
            }));
          }}
        />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 13 }}>
        <span style={{ minWidth: 150 }}>{t("Subagent thinking level")}</span>
        <Select
          value={config.subagent.thinking_level}
          style={MODEL_SELECT_STYLE}
          required
          options={THINKING_LEVELS}
          onChange={(value) => void apply((prev) => ({
            ...prev,
            subagent: { ...prev.subagent, thinking_level: value as ThinkingLevel },
          }))}
        />
      </label>
    </SettingsSection>
  );
}
