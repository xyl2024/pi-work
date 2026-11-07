"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { ProviderGearIcon, ProviderIcon, hasProviderIcon } from "@/components/ui/ProviderIcon";
import { ModelTable } from "@/components/settings/models-config/ModelTable";
import { modelsConfigProviderKindLabel } from "@/lib/shared/models-config-filter";
import {
  openModelsConfigAddModelName,
  openModelsConfigAddProvider,
  openModelsConfigApiKey,
  openModelsConfigModel,
  openModelsConfigOAuth,
  openModelsConfigProviderForm,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import styles from "./models-config.module.css";

export function ModelsConfigProviderDetail({ onBack }: { onBack?: () => void }) {
  const { t } = useI18n();
  const { view: state } = useModelsConfigPanel();
  const { config, providerNames, selectedProvider, selectedProviderKind, oauthProviders, apiKeyProviders } = state;
  const [search, setSearch] = useState({ key: "", query: "" });

  const kind = selectedProviderKind ?? "custom";
  const provider = kind === "custom" && selectedProvider !== null ? config.providers?.[selectedProvider] : undefined;
  const oauthProvider = kind === "subscription" ? oauthProviders.find((item) => item.id === selectedProvider) : undefined;
  const apiKeyProvider = kind === "apiKey" ? apiKeyProviders.find((item) => item.id === selectedProvider) : undefined;

  const known =
    selectedProvider !== null &&
    (kind === "custom" ? provider !== undefined : kind === "subscription" ? oauthProvider !== undefined : apiKeyProvider !== undefined);

  if (!known || selectedProvider === null) {
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

  const models = provider?.models ?? [];
  const searchKey = `${kind}:${selectedProvider}`;
  const query = search.key === searchKey ? search.query : "";
  const needle = query.trim().toLowerCase();
  const visible = models
    .map((model, index) => ({ model, index }))
    .filter(({ model }) => !needle || `${model.name ?? ""} ${model.id}`.toLowerCase().includes(needle));
  const connected = kind === "subscription" ? oauthProvider!.loggedIn : kind === "apiKey" ? apiKeyProvider!.configured : null;
  const title = providerNames[selectedProvider] ?? (kind === "subscription"
    ? oauthProvider!.name
    : kind === "apiKey"
      ? apiKeyProvider!.displayName
      : selectedProvider);
  const iconId = provider?.icon ?? selectedProvider;
  const modelCount = kind === "custom" ? models.length : kind === "apiKey" ? apiKeyProvider!.modelCount : null;
  const openAuth = () => {
    if (kind === "subscription") openModelsConfigOAuth(selectedProvider);
    if (kind === "apiKey") openModelsConfigApiKey(selectedProvider);
  };

  return (
    <div className={styles.detail}>
      <div className={styles.summaryWrap}>
        <section className={styles.summaryCard} aria-label={title}>
          {onBack && (
            <button type="button" onClick={onBack} aria-label={t("Back")} className={styles.button}>
              <ArrowLeftIcon width={14} height={14} aria-hidden="true" />
            </button>
          )}
          <span className={styles.providerIcon} aria-hidden="true">
            {hasProviderIcon(iconId) ? <ProviderIcon id={iconId} size={22} /> : <ProviderGearIcon size={22} />}
          </span>
          <div className={styles.summaryIdentity}>
            <div className={styles.summaryTitle}>
              <h2 className={styles.detailTitle}>{title}</h2>
              <span className={styles.sourceBadge}>{t(modelsConfigProviderKindLabel(kind))}</span>
            </div>
            {modelCount !== null && <span className={styles.muted}>{t("{n} models", { n: modelCount })}</span>}
          </div>
          {connected !== null && (
            <button
              type="button"
              className={styles.statusButton}
              data-connected={connected ? "true" : undefined}
              onClick={openAuth}
            >
              <span className={styles.statusDot} aria-hidden="true" />
              {t(connected ? "Connected" : "Not connected")}
            </button>
          )}
          {kind === "custom" && (
            <button type="button" className={styles.button} onClick={() => openModelsConfigProviderForm(selectedProvider)}>
              {t("Settings")}
            </button>
          )}
        </section>
      </div>
      {kind === "custom" && (
        <div className={styles.detailBody}>
          <div className={styles.toolbar}>
            <h3 className={styles.title}>{t("Models")}</h3>
            <div className={styles.modelActions}>
              {models.length > 0 && (
                <input
                  type="search"
                  name="provider-model-filter"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  value={query}
                  onChange={(event) => setSearch({ key: searchKey, query: event.target.value })}
                  placeholder={t("Search models...")}
                  aria-label={t("Search models...")}
                  className={styles.search}
                />
              )}
              <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => openModelsConfigAddModelName(selectedProvider)}>
                + {t("Add model")}
              </button>
            </div>
          </div>
          {visible.length === 0 ? (
            <div className={styles.empty}>
              <span>{t(models.length === 0 ? "No models" : "No matching models")}</span>
              <button
                type="button"
                className={styles.button}
                onClick={() => models.length === 0
                  ? openModelsConfigAddModelName(selectedProvider)
                  : setSearch({ key: searchKey, query: "" })}
              >
                {t(models.length === 0 ? "Add model" : "Clear search")}
              </button>
            </div>
          ) : (
            <div className={styles.modelTable}>
              <ModelTable
                label={t("Models")}
                items={visible.map(({ model, index }) => ({
                  key: `${selectedProvider}:${index}:${model.id}`,
                  model,
                  onOpen: () => openModelsConfigModel(selectedProvider, index),
                }))}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
