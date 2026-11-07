"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { SearchIcon } from "@/components/ui/icons";
import { ProviderGearIcon, ProviderIcon, hasProviderIcon } from "@/components/ui/ProviderIcon";
import {
  catalogProviderRows,
  filterCatalogProviderRows,
  type CatalogConfiguredKeys,
} from "@/lib/shared/catalog-sections";
import { CatalogSourcesHelp } from "./CatalogSourcesHelp";
import { ModelTable } from "./ModelTable";
import { ListSkeleton } from "./ListSkeleton";
import { useModelsApi } from "./use-catalog-entries";
import styles from "./CatalogBrowser.module.css";

const SKELETON_PROVIDERS = 3;
const SKELETON_ROWS = 3;

export function CatalogBrowser({ configured }: { configured: CatalogConfiguredKeys }) {
  const { t } = useI18n();
  const { data, loading, refreshing, error, refresh } = useModelsApi();
  const catalog = data.catalog;
  const [query, setQuery] = useState("");
  const [openRaw, setOpenRaw] = useState<readonly string[]>([]);

  const rows = useMemo(
    () => catalogProviderRows({ providers: catalog.providers, configured }),
    [catalog.providers, configured],
  );
  const visible = useMemo(() => filterCatalogProviderRows(rows, query), [rows, query]);
  const rawById = useMemo(
    () => new Map(catalog.providers.map((provider) => [provider.id, provider])),
    [catalog.providers],
  );
  const rawVisible = (id: string) => openRaw.includes(id);
  const toggleRaw = (id: string) => {
    setOpenRaw(rawVisible(id) ? openRaw.filter((item) => item !== id) : [...openRaw, id]);
  };

  const busy = loading || refreshing;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.field}>
          <SearchIcon className={styles.fieldIcon} width={14} height={14} aria-hidden="true" />
          <input
            type="search"
            name="model-catalog-filter"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className={styles.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search providers and models...")}
            aria-label={t("Search providers and models...")}
          />
        </div>
        <span className={styles.note}>{t("Fetches from pi.dev and caches locally")}</span>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => { void refresh(); }}
          disabled={busy}
        >
          {refreshing ? t("Refreshing...") : t("Refresh catalog")}
        </button>
        <CatalogSourcesHelp />
      </div>

      <div className={styles.body} data-scroll-wide>
        {busy ? (
          <ListSkeleton rows={SKELETON_ROWS * SKELETON_PROVIDERS} label={t("Loading catalog...")} />
        ) : error ? (
          <div className={styles.state}>{error}</div>
        ) : visible.length === 0 ? (
          <div className={styles.state}>
            {query.trim() ? t("No matching providers or models") : t("No catalog data")}
          </div>
        ) : (
          <div className={styles.list}>
            {visible.map((row) => (
              <section key={row.id} className={styles.provider} aria-label={row.name}>
                <div className={styles.providerHeader}>
                  <span className={styles.providerIcon} aria-hidden="true">
                    {hasProviderIcon(row.id)
                      ? <ProviderIcon id={row.id} size={18} />
                      : <ProviderGearIcon size={18} />}
                  </span>
                  <div className={styles.identity}>
                    <div className={styles.titleRow}>
                      <span className={styles.providerName}>{row.name}</span>
                      <code className={styles.providerId}>{row.id}</code>
                      <span className={styles.badge}>{t(row.sourceLabel)}</span>
                      {row.configured && (
                        <span className={`${styles.badge} ${styles.badgeConfigured}`}>{t("Configured")}</span>
                      )}
                    </div>
                    <span className={styles.meta}>{t("{n} models", { n: row.modelCount })}</span>
                  </div>
                  <span className={styles.auth} data-configured={row.auth.configured ? "true" : undefined}>
                    <span className={styles.authDot} aria-hidden="true" />
                    {t(row.auth.configured ? "Connected" : "Not connected")}
                    {row.auth.label && <span className={styles.authLabel}>{row.auth.label}</span>}
                  </span>
                  <button
                    type="button"
                    className={styles.rawToggle}
                    aria-expanded={rawVisible(row.id)}
                    onClick={() => toggleRaw(row.id)}
                  >
                    {t(rawVisible(row.id) ? "Hide raw data" : "View raw data")}
                  </button>
                </div>
                {rawVisible(row.id) && (
                  <pre className={styles.raw}>{JSON.stringify(rawById.get(row.id) ?? row, null, 2)}</pre>
                )}
                {row.modelCount === 0 ? (
                  <div className={styles.emptyModels}>{t("No models")}</div>
                ) : (
                  <ModelTable
                    label={row.name}
                    items={row.models.map((item) => ({
                      key: item.key,
                      model: item.model,
                      badge: item.configured ? "Configured" : undefined,
                    }))}
                  />
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
