"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ProviderGearIcon, ProviderIcon, hasProviderIcon } from "@/components/ui/ProviderIcon";
import {
  openModelsConfigAddProvider,
  openModelsConfigCatalog,
  selectModelsConfigChangedProviderNames,
  selectModelsConfigProvider,
  setModelsConfigProviderFilter,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import {
  filterModelsConfigProviderSections,
  modelsConfigProviderSections,
  type ModelsConfigProviderRow,
} from "@/lib/shared/models-config-filter";
import styles from "./models-config.module.css";

const MATCH_PREVIEW_LIMIT = 2;

function matchedLabel(row: ModelsConfigProviderRow): string | null {
  if (row.matchedModels.length === 0) return null;
  const shown = row.matchedModels.slice(0, MATCH_PREVIEW_LIMIT).join(", ");
  const rest = row.matchedModels.length - MATCH_PREVIEW_LIMIT;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

export function ModelsConfigProviderList() {
  const { t } = useI18n();
  const { view } = useModelsConfigPanel();
  const { config, oauthProviders, apiKeyProviders, providerFilter, selectedProvider, selectedProviderKind, providerNames } = view;
  const changedProviders = selectModelsConfigChangedProviderNames(view);
  const sections = useMemo(
    () =>
      modelsConfigProviderSections({
        oauthProviders,
        apiKeyProviders,
        providers: config.providers ?? {},
        providerNames,
        changedProviders,
      }),
    [oauthProviders, apiKeyProviders, config.providers, providerNames, changedProviders],
  );
  const visible = useMemo(
    () => filterModelsConfigProviderSections(sections, providerFilter),
    [sections, providerFilter],
  );
  const total = useMemo(
    () => sections.reduce((count, section) => count + section.rows.length, 0),
    [sections],
  );

  const openRow = (row: ModelsConfigProviderRow) => {
    selectModelsConfigProvider(row.id, row.kind);
  };

  return (
    <nav className={styles.navigation} aria-label={t("Providers")}>
      <div className={styles.navigationHeader}>
        <div className={styles.heading}>
          <h2 className={styles.title}>
            {t("Providers")} <span className={styles.count}>{total}</span>
          </h2>
        </div>
        <input
          type="search"
          name="provider-filter"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          value={providerFilter}
          onChange={(event) => setModelsConfigProviderFilter(event.target.value)}
          placeholder={t("Search providers and models...")}
          aria-label={t("Search providers and models...")}
          className={styles.search}
        />
      </div>
      <div data-scroll-side className={styles.providerScroll}>
        {total === 0 ? (
          <div className={styles.empty}>
            <span>{t("No providers configured")}</span>
            <button type="button" className={styles.button} onClick={openModelsConfigAddProvider}>
              {t("Add provider")}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>
            <span>{t("No matching providers or models")}</span>
            <button type="button" className={styles.button} onClick={() => setModelsConfigProviderFilter("")}>
              {t("Clear search")}
            </button>
          </div>
        ) : (
          visible.map((section) => (
            <section key={section.kind} className={styles.providerSection} aria-label={t(section.titleKey)}>
              <h3 className={styles.sectionTitle}>
                {t(section.titleKey)} <span className={styles.count}>{section.rows.length}</span>
              </h3>
              {section.rows.map((row) => {
                const iconId = row.kind === "custom" ? config.providers?.[row.id]?.icon ?? row.id : row.id;
                const selected = selectedProvider === row.id && selectedProviderKind === row.kind;
                const preview = matchedLabel(row);
                return (
                  <button
                    key={row.key}
                    type="button"
                    className={styles.providerRow}
                    aria-current={selected ? "true" : undefined}
                    data-changed={row.changed ? "true" : undefined}
                    onClick={() => openRow(row)}
                  >
                    <span className={styles.providerIcon} aria-hidden="true">
                      {iconId && hasProviderIcon(iconId) ? <ProviderIcon id={iconId} size={18} /> : <ProviderGearIcon size={18} />}
                    </span>
                    <span className={styles.providerText}>
                      <span className={styles.providerName}>{row.name}</span>
                      {row.kind !== "subscription" && (
                        <span className={styles.muted}>{t("{n} models", { n: row.modelCount })}</span>
                      )}
                    </span>
                    {preview && <span className={styles.matchPreview}>{preview}</span>}
                    {row.changed && (
                      <span
                        className={styles.unsavedDot}
                        role="img"
                        aria-label={t("Unsaved changes")}
                        title={t("Unsaved changes")}
                      />
                    )}
                    <span className={styles.muted} aria-hidden="true">›</span>
                  </button>
                );
              })}
            </section>
          ))
        )}
      </div>
      <div className={styles.navigationFooter}>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={openModelsConfigAddProvider}>
          <span aria-hidden="true">+</span> {t("Add provider")}
        </button>
        <button type="button" className={styles.catalog} onClick={openModelsConfigCatalog}>
          <span>{t("Model catalog")}</span>
          <span aria-hidden="true">↗</span>
        </button>
      </div>
    </nav>
  );
}
