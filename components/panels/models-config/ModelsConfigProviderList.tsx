"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ProviderGearIcon, ProviderIcon, hasProviderIcon } from "@/components/ui/ProviderIcon";
import {
  openModelsConfigAddProvider,
  openModelsConfigApiKey,
  openModelsConfigCatalog,
  openModelsConfigOAuth,
  selectModelsConfigProvider,
  setModelsConfigProviderFilter,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import {
  filterModelsConfigProviderRows,
  modelsConfigProviderRows,
  type ModelsConfigProviderKind,
  type ModelsConfigProviderRow,
} from "@/lib/shared/models-config-filter";
import styles from "./models-config.module.css";

const KIND_LABEL: Record<ModelsConfigProviderKind, string> = {
  subscription: "Subscription",
  apiKey: "API Key",
  custom: "Custom",
};

export function ModelsConfigProviderList() {
  const { t } = useI18n();
  const { view, pages } = useModelsConfigPanel();
  const { config, oauthProviders, apiKeyProviders, providerFilter, selectedProvider, providerNames } = view;
  const page = pages[pages.length - 1];
  const rows = useMemo(
    () => modelsConfigProviderRows({ oauthProviders, apiKeyProviders, providers: config.providers ?? {} })
      .map((row) => row.kind === "custom" ? { ...row, name: providerNames[row.id] ?? row.name } : row),
    [oauthProviders, apiKeyProviders, config.providers, providerNames],
  );
  const visible = useMemo(() => filterModelsConfigProviderRows(rows, providerFilter), [rows, providerFilter]);

  const openRow = (row: ModelsConfigProviderRow) => {
    if (row.kind === "subscription") return openModelsConfigOAuth(row.id);
    if (row.kind === "apiKey") return openModelsConfigApiKey(row.id);
    selectModelsConfigProvider(row.id);
  };

  return (
    <nav className={styles.navigation} aria-label={t("Providers")}>
      <div className={styles.navigationHeader}>
        <div className={styles.heading}>
          <h2 className={styles.title}>{t("Providers")} <span className={styles.count}>{rows.length}</span></h2>
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={openModelsConfigAddProvider} aria-label={t("Add provider")}>
            <span aria-hidden="true">+</span> {t("Add")}
          </button>
        </div>
        <input
          type="search"
          name="provider-filter"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          value={providerFilter}
          onChange={(event) => setModelsConfigProviderFilter(event.target.value)}
          placeholder={t("Search providers...")}
          aria-label={t("Search providers...")}
          className={styles.search}
        />
      </div>
      <div data-scroll-side className={styles.providerScroll}>
        {visible.length === 0 ? (
          <div className={styles.empty}>
            <span>{t(rows.length === 0 ? "No providers configured" : "No matching providers or models")}</span>
            {rows.length === 0 ? (
              <button type="button" className={styles.button} onClick={openModelsConfigAddProvider}>{t("Add provider")}</button>
            ) : (
              <button type="button" className={styles.button} onClick={() => setModelsConfigProviderFilter("")}>{t("Clear search")}</button>
            )}
          </div>
        ) : visible.map((row) => {
          const iconId = row.kind === "custom" ? config.providers?.[row.id]?.icon ?? row.id : row.id;
          const selected = row.kind === "custom"
            ? page?.kind === "root" && selectedProvider === row.id
            : (page?.kind === "oauth" && row.kind === "subscription" || page?.kind === "apikey" && row.kind === "apiKey") && page.providerId === row.id;
          return (
            <button key={`${row.kind}:${row.id}`} type="button" className={styles.providerRow} aria-current={selected ? "true" : undefined} onClick={() => openRow(row)}>
              <span className={styles.providerIcon} aria-hidden="true">
                {iconId && hasProviderIcon(iconId) ? <ProviderIcon id={iconId} size={18} /> : <ProviderGearIcon size={18} />}
              </span>
              <span className={styles.providerText}>
                <span className={styles.providerName}>{row.name}</span>
                <span className={styles.muted}>
                  {t(KIND_LABEL[row.kind])}
                  {row.kind !== "subscription" && ` · ${t("{n} models", { n: row.modelCount })}`}
                </span>
              </span>
              <span className={styles.muted} aria-hidden="true">›</span>
            </button>
          );
        })}
      </div>
      <div className={styles.navigationFooter}>
        <button type="button" className={styles.catalog} onClick={openModelsConfigCatalog}>
          <span>{t("Model catalog")}</span><span aria-hidden="true">↗</span>
        </button>
      </div>
    </nav>
  );
}
