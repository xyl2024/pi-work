"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Tag } from "@/hooks/useTodos";
import type { Filters } from "./types";
import { CreateTodoInput } from "./CreateTodoInput";
import { AgentToolsPopover } from "./AgentToolsPopover";
import { FilterPopover } from "./FilterPopover";
import { TagManagerPopover } from "./TagManagerPopover";
import { SearchPopover } from "./SearchPopover";

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
  tagCounts,
  onRenameTag,
  onDeleteTag,
  onSetTagColor,
  onRefresh,
  refreshing,
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
  tagCounts: Record<string, number>;
  onRenameTag: (from: string, to: string) => Promise<void>;
  onDeleteTag: (tag: string) => Promise<void>;
  onSetTagColor: (tag: string, color: string | null) => Promise<void>;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useI18n();
  const [agentToolsOpen, setAgentToolsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const searchActive = searchTerm.trim().length > 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      <CreateTodoInput onCreate={onCreate} tagSuggestions={tagSuggestions} />
      <button
        onClick={onRefresh}
        disabled={refreshing}
        aria-label={t("Refresh")}
        title={t("Refresh")}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 22, height: 22, padding: 0,
          flexShrink: 0,
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: 4,
          cursor: refreshing ? "default" : "pointer",
          color: "var(--text-muted)",
          fontFamily: "inherit",
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            animation: refreshing ? "spin 0.8s linear infinite" : undefined,
          }}
        >
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          onClick={() => setAgentToolsOpen(!agentToolsOpen)}
          aria-haspopup="dialog"
          aria-expanded={agentToolsOpen}
          aria-label={t("Agent tools settings")}
          title={t("Agent tools settings")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, padding: 0,
            flexShrink: 0,
            background: agentToolsOpen ? "var(--bg-selected)" : "transparent",
            border: "1px solid var(--border)",
            borderRadius: 4,
            cursor: "pointer",
            color: agentToolsOpen ? "var(--text)" : "var(--text-muted)",
            fontFamily: "inherit",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="5.5" cy="5.5" r="1.7" />
            <path d="M5.5 1.5v1.3M5.5 8.2v1.3M1.5 5.5h1.3M8.2 5.5h1.3M2.7 2.7l.9.9M7.4 7.4l.9.9M2.7 8.3l.9-.9M7.4 3.6l.9-.9" />
          </svg>
        </button>
        {agentToolsOpen && (
          <AgentToolsPopover onClose={() => setAgentToolsOpen(false)} />
        )}
      </div>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          onClick={() => onFilterOpenChange(!filterOpen)}
          aria-haspopup="dialog"
          aria-expanded={filterOpen}
          aria-label={t("Filter")}
          title={t("Filter")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, padding: 0,
            flexShrink: 0,
            background: filterActive || filterOpen ? "var(--bg-selected)" : "transparent",
            border: "1px solid var(--border)",
            borderRadius: 4,
            cursor: "pointer",
            color: filterActive || filterOpen ? "var(--text)" : "var(--text-muted)",
            transition: "background 0.1s, color 0.1s",
            fontFamily: "inherit",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polygon points="1,1.5 9,1.5 6.2,5.2 6.2,8.5 3.8,8.5 3.8,5.2" />
          </svg>
        </button>
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
        <button
          onClick={() => setTagsOpen(!tagsOpen)}
          aria-haspopup="dialog"
          aria-expanded={tagsOpen}
          aria-label={t("Manage tags")}
          title={t("Manage tags")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, padding: 0,
            flexShrink: 0,
            background: tagsOpen ? "var(--bg-selected)" : "transparent",
            border: "1px solid var(--border)",
            borderRadius: 4,
            cursor: "pointer",
            color: tagsOpen ? "var(--text)" : "var(--text-muted)",
            transition: "background 0.1s, color 0.1s",
            fontFamily: "inherit",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M8.5 1.5 H3 a1.5 1.5 0 0 0 -1.5 1.5 v5.5 a1.5 1.5 0 0 0 1.5 1.5 h5.5 a1.5 1.5 0 0 0 1.5 -1.5 V3.5 z" />
            <circle cx="4" cy="6" r="0.9" fill="currentColor" />
          </svg>
        </button>
        {tagsOpen && (
          <TagManagerPopover
            onClose={() => setTagsOpen(false)}
            tagSuggestions={tagSuggestions}
            tagCounts={tagCounts}
            onRename={onRenameTag}
            onDelete={onDeleteTag}
            onSetColor={onSetTagColor}
          />
        )}
      </div>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          onClick={() => setSearchOpen(!searchOpen)}
          aria-haspopup="dialog"
          aria-expanded={searchOpen}
          aria-label={t("Search")}
          title={t("Search")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, padding: 0,
            flexShrink: 0,
            background: searchActive || searchOpen ? "var(--bg-selected)" : "transparent",
            border: "1px solid var(--border)",
            borderRadius: 4,
            cursor: "pointer",
            color: searchActive || searchOpen ? "var(--text)" : "var(--text-muted)",
            transition: "background 0.1s, color 0.1s",
            fontFamily: "inherit",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="4.5" cy="4.5" r="2.5" />
            <line x1="6.5" y1="6.5" x2="9" y2="9" />
          </svg>
        </button>
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