"use client";

import { useI18n } from "@/hooks/useI18n";
import type { FileMentionEntry } from "./chat-input/hooks/useFileMentionMenu";
import { getFileIcon, FolderIcon } from "../files/FileIcons";

export function FileMentionMenu({
  items,
  activeIndex,
  loading,
  error,
  onSelect,
  onRetry,
  page,
  pageCount,
}: {
  items: FileMentionEntry[];
  activeIndex: number;
  loading: boolean;
  error: string | null;
  onSelect: (item: FileMentionEntry) => void;
  onRetry: () => void;
  page: number;
  pageCount: number;
}) {
  const { t } = useI18n();
  if (loading) return <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-dim)" }}>{t("Loading files...")}</div>;
  if (error) return (
    <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-dim)" }}>
      <div>{t("Failed to load file")}</div>
      <button type="button" onMouseDown={(event) => { event.preventDefault(); onRetry(); }} style={{ marginTop: 6, padding: "3px 7px", fontSize: 11, cursor: "pointer" }}>{t("Retry")}</button>
    </div>
  );
  if (items.length === 0) return <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-dim)" }}>{t("No files found")}</div>;
  return (
    <div role="listbox" aria-label={t("Files") as string}>
      {items.map((item, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={`${item.fullPath}:${item.isParent ? "parent" : "entry"}`}
            type="button"
            role="option"
            aria-selected={active}
            onMouseDown={(event) => { event.preventDefault(); onSelect(item); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 9,
              padding: "8px 10px", background: active ? "var(--bg-selected)" : "none",
              border: "none", borderBottom: "1px solid color-mix(in srgb, var(--border) 55%, transparent)",
              color: active ? "var(--text)" : "var(--text-muted)", cursor: "pointer", textAlign: "left",
            }}
          >
            <span aria-hidden="true" style={{ width: 18, color: "var(--accent)", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center" }}>
              {item.isParent ? "↩" : item.isDir ? <FolderIcon size={14} name={item.name} /> : getFileIcon(item.name, 14)}
            </span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {item.name}{item.isDir && !item.isParent ? "/" : ""}
            </span>
          </button>
        );
      })}
      <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-dim)", textAlign: "right" }}>
        {t("↑↓ switch, ←→ page, Enter to pick")} {pageCount > 1 ? `(${page + 1}/${pageCount})` : ""}
      </div>
    </div>
  );
}
