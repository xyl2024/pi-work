"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  catalogSearchResults,
  moveCatalogHighlight,
  type CatalogModelEntry,
} from "@/lib/shared/catalog-search";
import type { RuntimeModelInfo } from "@/lib/shared/models-config";
import { SearchIcon } from "@/components/ui/icons";
import { ModelTable, type ModelTableItem } from "./ModelTable";
import { ListSkeleton } from "./ListSkeleton";
import styles from "./CatalogSearch.module.css";

export interface CatalogSearchProps {
  entries: readonly CatalogModelEntry[];
  loading: boolean;
  error: string | null;
  onSelect: (model: RuntimeModelInfo) => void;
  onExit: () => void;
  onSkip?: () => void;
}

const SKELETON_ROWS = 8;

export function CatalogSearch({ entries, loading, error, onSelect, onExit, onSkip }: CatalogSearchProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setHighlight(0);
  }, [query, entries]);

  const results = useMemo(() => catalogSearchResults(entries, query), [entries, query]);
  const items = useMemo<ModelTableItem[]>(
    () => results.map(({ model, providerName }) => ({
      key: `${providerName}:${model.provider}:${model.id}`,
      model,
      onOpen: () => onSelect(model),
    })),
    [results, onSelect],
  );
  const activeKey = items[Math.min(highlight, items.length - 1)]?.key ?? null;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) =>
        moveCatalogHighlight(Math.min(current, results.length - 1), results.length, event.key === "ArrowDown" ? 1 : -1),
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const picked = results[Math.min(highlight, results.length - 1)];
      if (picked) onSelect(picked.model);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onExit();
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.field}>
          <SearchIcon className={styles.fieldIcon} width={14} height={14} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            name="catalog-search"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className={styles.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("Search all providers and models...")}
            aria-label={t("Search all providers and models...")}
          />
        </div>
        <div className={styles.notes}>
          <span>{t("Only model fields are filled; provider settings stay unchanged.")}</span>
          {!loading && !error && query.trim() !== "" && (
            <span>{t("{n} matching models", { n: results.length })}</span>
          )}
        </div>
      </div>

      <div className={styles.results} data-scroll-wide>
        {loading ? (
          <ListSkeleton rows={SKELETON_ROWS} label={t("Loading catalog...")} />
        ) : error ? (
          <div className={styles.state}>{error}</div>
        ) : items.length === 0 ? (
          <div className={styles.state}>{query.trim() ? t("No matching models") : t("No catalog data")}</div>
        ) : (
          <ModelTable
            items={items}
            activeKey={activeKey}
            onHoverItem={(item) => {
              const index = items.findIndex((candidate) => candidate.key === item.key);
              if (index >= 0) setHighlight(index);
            }}
          />
        )}
      </div>

      <div className={styles.footer}>
        <span>{t("↑↓ to navigate · Enter to select · Esc to cancel")}</span>
        {onSkip && (
          <button type="button" className={styles.skip} onClick={onSkip}>
            {t("Skip and fill in manually")}
          </button>
        )}
      </div>
    </div>
  );
}
