"use client";

import { useI18n } from "@/hooks/useI18n";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { ModelConnectionTest } from "@/components/settings/models-config/ModelConnectionTest";
import { ModelEntryCard } from "@/components/settings/models-config/ModelEntryCard";
import { SectionTitle } from "@/components/settings/models-config/form-fields";
import {
  deleteModelsConfigProvider,
  openModelsConfigAddModelName,
  openModelsConfigAddProvider,
  openModelsConfigModel,
  openModelsConfigProviderForm,
  selectModelsConfigDirty,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";

export function ModelsConfigProviderDetail({ onBack }: { onBack?: () => void }) {
  const { t } = useI18n();
  const { view: state } = useModelsConfigPanel();
  const { config, providerNames, selectedProvider } = state;
  const providers = config.providers ?? {};
  const providerCount = Object.keys(providers).length;

  if (selectedProvider === null) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {t(providerCount === 0 ? "No providers configured" : "Select a provider")}
        </div>
        {providerCount === 0 && (
          <button
            type="button"
            onClick={() => openModelsConfigAddProvider()}
            style={{ padding: "5px 12px", background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", cursor: "pointer", fontSize: 12 }}
          >
            {t("Add provider")}
          </button>
        )}
      </div>
    );
  }

  const provider = providers[selectedProvider];
  if (!provider) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-dim)" }}>
        {t("Select a provider")}
      </div>
    );
  }

  const name = selectedProvider;
  const models = provider.models ?? [];
  const testDisabled = selectModelsConfigDirty(state) || state.saving || !!state.rawEdit;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t("Back")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, background: "none", border: "none", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}
          >
            <ArrowLeftIcon width={14} height={14} aria-hidden="true" />
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {providerNames[name] ?? name}
          </div>
          <div style={{ marginTop: 2, fontSize: 10, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {provider.api ?? t("API")}
            {provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
            {` · ${t("{n} models", { n: models.length })}`}
          </div>
        </div>
        <button
          type="button"
          onClick={() => openModelsConfigProviderForm(name)}
          style={{ padding: "3px 8px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: 11, flexShrink: 0 }}
        >
          {t("Edit provider")}
        </button>
        <button
          type="button"
          onClick={() => deleteModelsConfigProvider(name)}
          style={{ padding: "3px 8px", background: "none", border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)", borderRadius: 4, color: "var(--error)", cursor: "pointer", fontSize: 11, flexShrink: 0 }}
        >
          {t("Delete")}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12 }}>
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
                  <ModelConnectionTest provider={name} modelId={model.id} disabled={testDisabled} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
