"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Tag } from "@/hooks/useTodos";
import type { Filters } from "./types";
import { CreateTodoInput } from "./CreateTodoInput";
import { FilterPopover } from "./FilterPopover";
import { SearchPopover } from "./SearchPopover";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * Todo header bar. Kept intentionally minimal — just the create-task
 * input plus Filter and Search buttons. Custom-tools and tag-manager
 * settings live in the global Settings modal now, so the only stateful
 * affordances here are filter and search.
 *
 * Both action buttons are icon-only (no chrome) and use the project's
 * unified `Tooltip` for hover affordance. The active state swaps
 * background + foreground color so an open popover or an active
 * filter/search stays visible without relying on the tooltip.
 */
export function FilterBar({
  filters,
  onFiltersChange,
  filterOpen,
  onFilterOpenChange,
  filterActive,
  onCreate,
  searchTerm,
  onSearchChange,
  tagSuggestions,
}: {
  filters: Filters;
  onFiltersChange: (next: Filters) => void;
  filterOpen: boolean;
  onFilterOpenChange: (open: boolean) => void;
  filterActive: boolean;
  onCreate: (input: { title: string; tags?: string[] }) => Promise<boolean>;
  searchTerm: string;
  onSearchChange: (v: string) => void;
  tagSuggestions: Tag[];
}) {
  const { t } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchActive = searchTerm.trim().length > 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", flexShrink: 0 }}>
      <CreateTodoInput onCreate={onCreate} tagSuggestions={tagSuggestions} />
      <div style={{ position: "relative", flexShrink: 0 }}>
        <Tooltip content={t("Filter")} side="bottom">
          <button
            onClick={() => onFilterOpenChange(!filterOpen)}
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
            aria-label={t("Filter")}
            style={iconButtonStyle(filterActive || filterOpen)}
          >
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polygon points="1,1.5 9,1.5 6.2,5.2 6.2,8.5 3.8,8.5 3.8,5.2" />
            </svg>
          </button>
        </Tooltip>
        {filterOpen && (
          <FilterPopover
            filters={filters}
            onChange={onFiltersChange}
            onClose={() => onFilterOpenChange(false)}
            tagSuggestions={tagSuggestions}
          />
        )}
      </div>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <Tooltip content={t("Search")} side="bottom">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            aria-haspopup="dialog"
            aria-expanded={searchOpen}
            aria-label={t("Search")}
            style={iconButtonStyle(searchActive || searchOpen)}
          >
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="4.5" cy="4.5" r="2.5" />
              <line x1="6.5" y1="6.5" x2="9" y2="9" />
            </svg>
          </button>
        </Tooltip>
        {searchOpen && (
          <SearchPopover
            value={searchTerm}
            onChange={onSearchChange}
            onClose={() => setSearchOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function iconButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 22, height: 22, padding: 0,
    flexShrink: 0,
    background: active ? "var(--bg-selected)" : "transparent",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    color: active ? "var(--text)" : "var(--text-muted)",
    fontFamily: "inherit",
    transition: "background 0.12s, color 0.12s",
  };
}
