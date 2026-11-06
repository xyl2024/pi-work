"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ProviderGearIcon, ProviderIcon } from "@/components/ui/ProviderIcon";
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

function ProviderCard({
  name,
  icon,
  meta,
  trailing,
  onClick,
}: {
  name: ReactNode;
  icon: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.card} onClick={onClick}>
      <span className={styles.cardIcon}>{icon}</span>
      <span className={styles.cardText}>
        <span className={styles.cardName}>{name}</span>
        {meta && <span className={styles.cardMeta}>{meta}</span>}
      </span>
      <span className={styles.cardTrailing}>
        {trailing}
        <span className={styles.cardChevron}><ChevronIcon /></span>
      </span>
    </button>
  );
}

function CustomCard({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className={styles.card} onClick={onClick}>
      <span className={`${styles.cardIcon} ${styles.cardIconDashed}`}><PlusIcon /></span>
      <span className={styles.cardText}>
        <span className={styles.cardName}>{t("OpenAI / Anthropic compatible")}</span>
        <span className={styles.cardMeta}>{t("Custom endpoint format")}</span>
      </span>
      <span className={styles.cardTrailing}>
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

  const q = search.trim().toLowerCase();
  const availableOAuth = useMemo(
    () => oauthProviders.filter((p) => !p.loggedIn && (!q || `${p.name} ${p.id}`.toLowerCase().includes(q))),
    [oauthProviders, q],
  );
  const availableApiKey = useMemo(
    () => apiKeyProviders.filter((p) => !p.configured && (!q || `${p.displayName} ${p.id}`.toLowerCase().includes(q))),
    [apiKeyProviders, q],
  );
  const customSearchText = [
    t("Custom"), t("OpenAI / Anthropic compatible"), t("Custom endpoint format"),
    "custom", "openai-compatible", "anthropic-compatible",
  ].join(" ").toLowerCase();
  const showCustom = !q || customSearchText.includes(q);
  const totalCount = availableOAuth.length + availableApiKey.length + (showCustom ? 1 : 0);

  const clearSearch = () => {
    setSearch("");
    inputRef.current?.focus();
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

      {q && (
        <div className={styles.results} role="status" aria-live="polite">
          {totalCount > 0 ? t("{n} providers", { n: totalCount }) : t("No providers match")}
        </div>
      )}

      <div className={styles.body} data-scroll-wide>
        {totalCount === 0 ? (
          <div className={styles.emptyState}>
            <span>{q ? t("No providers match") : t("All providers configured")}</span>
            {q && (
              <button type="button" className={styles.emptyStateButton} onClick={clearSearch}>
                {t("Clear")}
              </button>
            )}
          </div>
        ) : (
          <>
            {(availableOAuth.length > 0 || !q) && (
              <section className={styles.section} aria-labelledby={`${idBase}-subscriptions`}>
                <h3 id={`${idBase}-subscriptions`} className={styles.sectionHeader}>
                  <span className={styles.sectionIcon}><SubscriptionIcon /></span>
                  {t("Subscriptions")}
                  <span className={styles.sectionCount}>{availableOAuth.length}</span>
                </h3>
                {availableOAuth.length === 0 ? (
                  <div className={styles.sectionEmpty}>{t("Nothing to add")}</div>
                ) : (
                  <div className={styles.grid}>
                    {availableOAuth.map((p) => (
                      <ProviderCard
                        key={p.id}
                        name={p.name}
                        icon={<ProviderIcon id={p.id} size={20} fallback={<ProviderGearIcon size={16} />} />}
                        trailing={t("Sign in")}
                        onClick={() => onSelectOAuth(p.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {(availableApiKey.length > 0 || !q) && (
              <section className={styles.section} aria-labelledby={`${idBase}-api-key`}>
                <h3 id={`${idBase}-api-key`} className={styles.sectionHeader}>
                  <span className={styles.sectionIcon}><ApiKeyIcon /></span>
                  {t("API Key")}
                  <span className={styles.sectionCount}>{availableApiKey.length}</span>
                </h3>
                {availableApiKey.length === 0 ? (
                  <div className={styles.sectionEmpty}>{t("Nothing to add")}</div>
                ) : (
                  <div className={styles.grid}>
                    {availableApiKey.map((p) => (
                      <ProviderCard
                        key={p.id}
                        name={p.displayName}
                        icon={<ProviderIcon id={p.id} size={20} fallback={<ProviderGearIcon size={16} />} />}
                        meta={t("{n} models", { n: p.modelCount })}
                        onClick={() => onSelectApiKey(p.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {showCustom && (
              <section className={styles.section} aria-labelledby={`${idBase}-custom`}>
                <h3 id={`${idBase}-custom`} className={styles.sectionHeader}>
                  <span className={styles.sectionIcon}><CustomIcon /></span>
                  {t("Custom")}
                  <span className={styles.sectionCount}>1</span>
                </h3>
                <div className={styles.grid}>
                  <CustomCard onClick={onAddCustom} />
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
