"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ProviderGearIcon, ProviderIcon } from "@/components/ui/ProviderIcon";
import {
  countModelsConfigShelfRows,
  filterModelsConfigShelfSections,
  modelsConfigShelfSections,
  type ModelsConfigShelfRow,
  type ModelsConfigShelfSection,
} from "@/lib/shared/models-config-shelf";
import type { ModelsConfigProviderKind } from "@/lib/shared/models-config-filter";
import type { ApiKeyProvider, OAuthProvider } from "./types";
import styles from "./AddProviderPicker.module.css";

interface AddProviderPickerBodyProps {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  backButton: ReactNode;
}

function SearchIcon() {
  return (
    <svg className={styles.searchIcon} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SubscriptionIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ApiKeyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3 21 2l-3 3 2 2-2 2-2-2-2 2 2 2" />
    </svg>
  );
}

function CustomIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

const SECTION_ICONS: Record<ModelsConfigProviderKind, () => ReactNode> = {
  subscription: SubscriptionIcon,
  apiKey: ApiKeyIcon,
  custom: CustomIcon,
};

function ShelfCard({ row, onOpen }: { row: ModelsConfigShelfRow; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className={styles.card} onClick={onOpen}>
      <span className={`${styles.cardIcon} ${row.kind === "custom" ? styles.cardIconDashed : ""}`}>
        {row.kind === "custom" ? (
          <PlusIcon />
        ) : (
          <ProviderIcon id={row.id} size={20} fallback={<ProviderGearIcon size={16} />} />
        )}
      </span>
      <span className={styles.cardText}>
        <span className={styles.cardName}>{row.kind === "custom" ? t(row.name) : row.name}</span>
        <span className={styles.cardMeta}>{t(row.summaryKey, row.summaryParams)}</span>
      </span>
      <span className={styles.cardTrailing}>
        <span className={styles.cardAction}>{t(row.actionLabelKey)}</span>
        <span className={styles.cardChevron}><ChevronIcon /></span>
      </span>
    </button>
  );
}

export function AddProviderPickerBody({
  oauthProviders, apiKeyProviders,
  onSelectOAuth, onSelectApiKey, onAddCustom, backButton,
}: AddProviderPickerBodyProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const idBase = useId();

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

  const sections = useMemo(
    () =>
      modelsConfigShelfSections({
        oauthProviders,
        apiKeyProviders,
        customKeywords: [t("Custom"), t("OpenAI / Anthropic compatible"), t("Custom endpoint format")],
      }),
    [oauthProviders, apiKeyProviders, t],
  );
  const filtered = useMemo(() => filterModelsConfigShelfSections(sections, search), [sections, search]);
  const totalCount = countModelsConfigShelfRows(filtered);
  const searching = search.trim() !== "";

  const clearSearch = () => {
    setSearch("");
    inputRef.current?.focus();
  };

  const open = (row: ModelsConfigShelfRow) => {
    if (row.action === "connect") onSelectOAuth(row.id);
    else if (row.action === "configure") onSelectApiKey(row.id);
    else onAddCustom();
  };

  return (
    <div className={styles.picker}>
      <div className={styles.toolbar}>
        {backButton}
        <div className={styles.searchField}>
          <SearchIcon />
          <input
            ref={inputRef}
            type="search"
            name="add-provider-filter"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className={styles.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Search providers...")}
            aria-label={t("Search providers...")}
          />
          {search && (
            <button type="button" className={styles.clearButton} onClick={clearSearch} aria-label={t("Clear")}>
              <ClearIcon />
            </button>
          )}
        </div>
      </div>

      {searching && (
        <div className={styles.results} role="status" aria-live="polite">
          {totalCount > 0 ? t("{n} providers", { n: totalCount }) : t("No providers match")}
        </div>
      )}

      <div className={styles.body} data-scroll-wide>
        {totalCount === 0 ? (
          <div className={styles.emptyState}>
            <span>{searching ? t("No providers match") : t("All providers configured")}</span>
            {searching && (
              <button type="button" className={styles.emptyStateButton} onClick={clearSearch}>
                {t("Clear")}
              </button>
            )}
          </div>
        ) : (
          filtered.map((section: ModelsConfigShelfSection) => {
            const SectionIcon = SECTION_ICONS[section.kind];
            return (
              <section key={section.kind} className={styles.section} aria-labelledby={`${idBase}-${section.kind}`}>
                <h3 id={`${idBase}-${section.kind}`} className={styles.sectionHeader}>
                  <span className={styles.sectionIcon}><SectionIcon /></span>
                  {t(section.titleKey)}
                  <span className={styles.sectionCount}>{section.rows.length}</span>
                </h3>
                {section.rows.length === 0 ? (
                  <div className={styles.sectionEmpty}>{t("Nothing to add")}</div>
                ) : (
                  <div className={styles.grid}>
                    {section.rows.map((row) => (
                      <ShelfCard key={row.key} row={row} onOpen={() => open(row)} />
                    ))}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
