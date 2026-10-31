"use client";

import { useI18n } from "@/hooks/useI18n";
import { ProviderFields } from "@/components/settings/models-config/ProviderFields";
import { ModelConnectionTest } from "@/components/settings/models-config/ModelConnectionTest";
import { ModelEntryCard } from "@/components/settings/models-config/ModelEntryCard";
import { SectionTitle } from "@/components/settings/models-config/form-fields";
import { PanelBackButton } from "../PanelBackButton";
import {
  deleteModelsConfigProvider,
  selectModelsConfigDirty,
  modelsConfigPanel,
  openModelsConfigAddModelName,
  openModelsConfigModel,
  renameModelsConfigProvider,
  updateModelsConfigProvider,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";

export function ModelsConfigProviderPage({ name }: { name: string }) {
  const { t } = useI18n();
  const { view: state } = useModelsConfigPanel();
  const { config, providerNames } = state;
  const provider = config.providers?.[name];
  if (!provider) return null;
  const models = provider.models ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <PanelBackButton panel={modelsConfigPanel} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>
          {name}
        </span>
        <button
          type="button"
          onClick={() => deleteModelsConfigProvider(name)}
          style={{ padding: "3px 8px", background: "none", border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)", borderRadius: 4, color: "var(--error)", cursor: "pointer", fontSize: 11, flexShrink: 0 }}
        >
          {t("Delete")}
        </button>
      </div>

      <ProviderFields
        name={providerNames[name] ?? name}
        provider={provider}
        onChange={(next) => updateModelsConfigProvider(name, next)}
        onRename={(nextName) => renameModelsConfigProvider(name, nextName)}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <SectionTitle>{t("Models")}</SectionTitle>
          <button
            type="button"
            onClick={() => openModelsConfigAddModelName(name)}
            style={{ padding: "3px 8px", background: "none", border: "1px dashed var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
          >
            + {t("Model")}
          </button>
        </div>
        {models.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("No models")}</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {models.map((model, index) => (
              <div key={index} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <ModelEntryCard
                  model={model}
                  providerIcon={provider.icon}
                  onOpen={() => openModelsConfigModel(name, index)}
                />
                <ModelConnectionTest provider={name} modelId={model.id} disabled={selectModelsConfigDirty(state) || state.saving || !!state.rawEdit} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
