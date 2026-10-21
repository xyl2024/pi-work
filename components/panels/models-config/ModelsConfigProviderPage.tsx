"use client";

import { useI18n } from "@/hooks/useI18n";
import { ProviderFields } from "@/components/settings/models-config/ProviderFields";
import { ModelEntryCard } from "@/components/settings/models-config/ModelEntryCard";
import { SectionTitle } from "@/components/settings/models-config/form-fields";
import {
  deleteModelsConfigProvider,
  modelsConfigBack,
  openModelsConfigAddModelName,
  openModelsConfigModel,
  renameModelsConfigProvider,
  updateModelsConfigProvider,
  useModelsConfigStore,
} from "@/lib/client/models-config-store";

/**
 * One provider's detail page. Full width, with a back control that returns to
 * the provider list — the panel navigates in levels instead of the modal's
 * 210px sidebar plus a detail column.
 *
 * Its model grid opens each model's own detail page; the model-detail slice
 * adds the grid and the "open a model" navigation the provider slice left out.
 */
export function ModelsConfigProviderPage({ name }: { name: string }) {
  const { t } = useI18n();
  const { config, providerNames } = useModelsConfigStore();
  const provider = config.providers?.[name];
  if (!provider) return null;
  const models = provider.models ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={modelsConfigBack}
          style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", fontSize: 12, flexShrink: 0 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 6 9 12 15 18" />
          </svg>
          {t("Back")}
        </button>
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
              <ModelEntryCard
                key={index}
                model={model}
                providerIcon={provider.icon}
                onOpen={() => openModelsConfigModel(name, index)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
