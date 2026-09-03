"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { THINKING_LEVELS, type ThinkingLevel } from "@/components/chat/ThinkingPicker";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import { SettingsSection } from "../SettingsSection";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

const selectStyle: React.CSSProperties = {
  minWidth: 260,
  height: 34,
  padding: "0 10px",
  color: "var(--text)",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 13,
};

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
        <select
          value={selectedModel}
          style={selectStyle}
          disabled={models.length === 0}
          onChange={(event) => {
            const value = event.target.value;
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
        >
          <option value="inherit">{t("Inherit parent model")}</option>
          {groupedModels.map(([provider, providerModels]) => (
            <optgroup key={provider} label={provider}>
              {providerModels.map((model) => (
                <option key={`${model.provider}:${model.id}`} value={`${model.provider}:${model.id}`}>
                  {model.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 13 }}>
        <span style={{ minWidth: 150 }}>{t("Subagent thinking level")}</span>
        <select
          value={config.subagent.thinking_level}
          style={selectStyle}
          onChange={(event) => void apply((prev) => ({
            ...prev,
            subagent: { ...prev.subagent, thinking_level: event.target.value as ThinkingLevel },
          }))}
        >
          {THINKING_LEVELS.map((level) => (
            <option key={level} value={level}>{level}</option>
          ))}
        </select>
      </label>
    </SettingsSection>
  );
}
