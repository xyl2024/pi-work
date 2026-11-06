"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { ProviderGearIcon, ProviderIcon, hasProviderIcon } from "@/components/ui/ProviderIcon";
import { ModelConnectionTest } from "@/components/settings/models-config/ModelConnectionTest";
import {
  openModelsConfigAddModelName,
  openModelsConfigAddProvider,
  openModelsConfigModel,
  openModelsConfigProviderForm,
  selectModelsConfigDirty,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import styles from "./models-config.module.css";

export function ModelsConfigProviderDetail({ onBack }: { onBack?: () => void }) {
  const { t } = useI18n();
  const { view: state } = useModelsConfigPanel();
  const { config, providerNames, selectedProvider, oauthProviders, apiKeyProviders } = state;
  const [search, setSearch] = useState({ provider: selectedProvider, query: "" });
  const query = search.provider === selectedProvider ? search.query : "";
  const provider = selectedProvider === null ? undefined : config.providers?.[selectedProvider];

  if (selectedProvider === null || !provider) {
    const hasProviders = Object.keys(config.providers ?? {}).length > 0
      || oauthProviders.some((item) => item.loggedIn)
      || apiKeyProviders.some((item) => item.configured);
    return (
      <div className={`${styles.empty} ${styles.welcome}`}>
        <span className={styles.providerIcon} aria-hidden="true"><ProviderGearIcon size={24} /></span>
        <h2 className={styles.detailTitle}>{t(hasProviders ? "Select a provider" : "Connect your first provider")}</h2>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={openModelsConfigAddProvider}>
          + {t("Add provider")}
        </button>
      </div>
    );
  }

  const name = selectedProvider;
  const models = provider.models ?? [];
  const needle = query.trim().toLowerCase();
  const visible = models.map((model, index) => ({ model, index }))
    .filter(({ model }) => !needle || `${model.name ?? ""} ${model.id}`.toLowerCase().includes(needle));
  const dirty = selectModelsConfigDirty(state);
  const testDisabled = dirty || state.saving || !!state.rawEdit;
  const iconId = provider.icon ?? name;

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <div className={styles.providerHeading}>
          {onBack && (
            <button type="button" onClick={onBack} aria-label={t("Back")} className={styles.button}>
              <ArrowLeftIcon width={14} height={14} aria-hidden="true" />
            </button>
          )}
          <span className={styles.providerIcon} aria-hidden="true">
            {hasProviderIcon(iconId) ? <ProviderIcon id={iconId} size={20} /> : <ProviderGearIcon size={20} />}
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 className={styles.detailTitle}>{providerNames[name] ?? name}</h2>
            <span className={styles.muted}>{t("{n} models", { n: models.length })}</span>
          </div>
        </div>
        <button type="button" className={styles.button} onClick={() => openModelsConfigProviderForm(name)}>{t("Provider settings")}</button>
      </div>
      <div className={styles.detailBody}>
        <div className={styles.toolbar}>
          <h3 className={styles.title}>{t("Models")}</h3>
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => openModelsConfigAddModelName(name)}>+ {t("Add model")}</button>
        </div>
        {models.length > 0 && (
          <div className={styles.toolbar}>
            <input type="search" name="provider-model-filter" autoComplete="off" data-1p-ignore data-lpignore="true" value={query} onChange={(event) => setSearch({ provider: name, query: event.target.value })} placeholder={t("Search models...")} aria-label={t("Search models...")} className={styles.search} />
            {needle && <span className={styles.count} role="status">{t("{n} matching models", { n: visible.length })}</span>}
          </div>
        )}
        {dirty && models.length > 0 && <p className={styles.notice}>{t("Save configuration before testing.")}</p>}
        {visible.length === 0 ? (
          <div className={styles.empty}>
            <span>{t(models.length === 0 ? "No models" : "No matching models")}</span>
            <button type="button" className={styles.button} onClick={() => models.length === 0 ? openModelsConfigAddModelName(name) : setSearch({ provider: name, query: "" })}>
              {t(models.length === 0 ? "Add model" : "Clear search")}
            </button>
          </div>
        ) : (
          <div className={styles.modelList}>
            {visible.map(({ model, index }) => (
              <div key={`${name}:${index}:${model.id}`} className={styles.modelRow}>
                <div className={styles.modelHeading}>
                  <button type="button" className={styles.modelLink} onClick={() => openModelsConfigModel(name, index)} aria-label={`${t("Edit model")}: ${model.name || model.id || t("new model")}`}>
                    <div className={styles.modelName}>{model.name || model.id || t("new model")}</div>
                    {model.name && model.id && <div className={styles.modelId}>{model.id}</div>}
                  </button>
                  <button type="button" className={styles.button} onClick={() => openModelsConfigModel(name, index)} aria-label={`${t("Edit model")}: ${model.name || model.id || t("new model")}`}>{t("Edit")}</button>
                </div>
                {(model.contextWindow != null || model.maxTokens != null || model.reasoning) && (
                  <div className={styles.modelMeta}>
                    {typeof model.contextWindow === "number" && <span>{t("Context window")} {model.contextWindow.toLocaleString()}</span>}
                    {typeof model.maxTokens === "number" && <span>{t("Max output")} {model.maxTokens.toLocaleString()}</span>}
                    {model.reasoning && <span>{t("Reasoning")}</span>}
                  </div>
                )}
                <ModelConnectionTest provider={name} modelId={model.id} disabled={testDisabled} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
