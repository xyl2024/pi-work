"use client";

import { useCallback, useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/shared/file-paths";
import { getFileIcon, FolderIcon } from "../../files/FileIcons";
import type { ComposerFileEntry } from "@/lib/client/composer-picker";
import { useComposerPicker } from "./useComposerPicker";
import { isInteractiveKeyboardTarget } from "./keyboard-target";
import { resolvePickerKeyAction, type PickerKeyRegion } from "@/lib/client/picker-keyboard";
import type { ComposerPickerViewProps } from "./types";

export function FilePickerView({ picker, cwd, onInsertText }: ComposerPickerViewProps) {
  const { t } = useI18n();
  const snapshot = useComposerPicker(picker);
  const file = snapshot.file;
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const focusFileRow = useCallback((index: number) => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-picker-file-row="${index}"]`)
      ?.focus();
  }, []);

  useEffect(() => {
    if (!snapshot.open || snapshot.view !== "file") return;
    const frame = requestAnimationFrame(() => {
      if (file.loading || file.error) {
        rootRef.current?.focus();
        return;
      }
      const firstRow = listRef.current?.querySelector<HTMLElement>("[data-picker-nav-row]");
      (firstRow ?? rootRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [file.directory, file.error, file.loading, snapshot.open, snapshot.view]);

  const activateEntry = useCallback((entry?: ComposerFileEntry) => {
    void picker.activateFile(entry).then((result) => {
      if (result?.kind !== "insert") return;
      onInsertText(result.text);
    });
  }, [onInsertText, picker]);

  useEffect(() => {
    if (!snapshot.open || snapshot.view !== "file") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") return;
      const target = event.target;
      const isRow = target instanceof HTMLElement && target.closest("[data-picker-nav-row]") !== null;
      const isTrigger = target instanceof HTMLElement && target.closest('[aria-haspopup="menu"]') !== null;
      const region: PickerKeyRegion = isRow
        ? "navigation"
        : isTrigger
          ? "trigger"
          : isInteractiveKeyboardTarget(target)
            ? "control"
            : "navigation";
      const action = resolvePickerKeyAction({
        key: event.key,
        region,
        view: "file",
        composing: event.isComposing,
      });
      if (action === "native" || action === "back") return;
      event.preventDefault();
      if (action === "move-previous" || action === "move-next") {
        picker.moveFileActive(action === "move-next" ? 1 : -1);
        focusFileRow(picker.get().file.activeIndex);
        return;
      }
      if (action === "page-previous" || action === "page-next") {
        picker.nextFilePage(action === "page-next" ? 1 : -1);
        requestAnimationFrame(() => focusFileRow(picker.get().file.activeIndex));
        return;
      }
      if (action === "toggle-selection") {
        picker.toggleFileSelected();
        return;
      }
      if (action === "activate") activateEntry();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activateEntry, focusFileRow, picker, snapshot.open, snapshot.view]);

  const confirmSelection = () => {
    const text = picker.confirmFileSelection();
    if (!text) return;
    onInsertText(text);
  };

  const title = file.directory
    ? `${file.directory}/`
    : cwd ? getFileName(cwd) : "/";
  const selectedCount = file.selected.length;
  const pageCount = picker.filePageCount();
  const visibleEntries = picker.fileVisibleEntries();
  const hasEntries = picker.hasFileEntries();

  return (
    <div ref={rootRef} tabIndex={-1} style={{ display: "flex", flexDirection: "column", minHeight: 0, maxHeight: "100%", outline: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", borderBottom: "1px solid var(--border)" }}>
        <button
          type="button"
          onClick={() => picker.back()}
          aria-label={t("Back")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24,
            padding: 0, background: "none", border: "none", borderRadius: 6,
            color: "var(--text-muted)", cursor: "pointer",
          }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600 }}>
          {title}
        </span>
      </div>

      {file.loading ? (
        <div style={{ padding: "12px", fontSize: 12, color: "var(--text-dim)" }}>{t("Loading files...")}</div>
      ) : file.error ? (
        <div style={{ padding: "12px", fontSize: 12, color: "var(--text-dim)" }}>
          <div>{t("Failed to load file")}</div>
          <button type="button" onClick={() => void picker.retryFileDirectory()} style={{ marginTop: 6, padding: "3px 7px", fontSize: 11, cursor: "pointer" }}>
            {t("Retry")}
          </button>
        </div>
      ) : file.entries.length === 0 ? (
        <div style={{ padding: "12px", fontSize: 12, color: "var(--text-dim)" }}>{t("Empty folder")}</div>
      ) : (
        <>
          {!hasEntries && (
            <div style={{ padding: "10px 12px 2px", fontSize: 12, color: "var(--text-dim)" }}>{t("Empty folder")}</div>
          )}
          <div ref={listRef} role="listbox" aria-label={t("Files")} style={{ overflowY: "auto", minHeight: 0, padding: "4px" }}>
            {visibleEntries.map((entry, index) => {
              const active = index === file.activeIndex;
              const selected = file.selected.includes(entry.path);
              return (
                <div
                  key={`${entry.path}:${entry.isParent ? "parent" : "entry"}`}
                  role="option"
                  aria-selected={active}
                  tabIndex={-1}
                  data-picker-nav-row
                  data-picker-file-row={index}
                  onMouseEnter={() => picker.setFileActiveIndex(index)}
                  onFocus={() => picker.setFileActiveIndex(index)}
                  onClick={() => void activateEntry(entry)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", padding: "7px 8px",
                    background: active ? "var(--bg-selected)" : "none",
                    borderRadius: 6,
                    color: active ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer", fontSize: 12,
                  }}
                >
                  <span aria-hidden="true" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 17, flexShrink: 0, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                    {entry.isParent ? "↩" : entry.isDir ? <FolderIcon size={14} name={entry.name} /> : getFileIcon(entry.name, 14)}
                  </span>
                  <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
                    {entry.name}{entry.isDir && !entry.isParent ? "/" : ""}
                  </span>
                  {!entry.isDir && (
                    <input
                      type="checkbox"
                      checked={selected}
                      aria-label={t("Select {name}", { name: entry.name })}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => picker.toggleFileSelected(entry)}
                      style={{ flexShrink: 0, cursor: "pointer" }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderTop: file.entries.length > 0 ? "1px solid var(--border)" : "none" }}>
        <span style={{ flex: 1, fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t("↑↓ switch, ←→ page, Enter to pick")}{pageCount > 1 ? ` (${file.page + 1}/${pageCount})` : ""}
        </span>
        {selectedCount > 0 && (
          <button
            type="button"
            onClick={confirmSelection}
            style={{
              flexShrink: 0, padding: "4px 9px", fontSize: 11, fontWeight: 600,
              color: "var(--bg-panel)", background: "var(--accent)",
              border: "none", borderRadius: 6, cursor: "pointer",
            }}
          >
            {t("Add {n} items", { n: selectedCount })}
          </button>
        )}
      </div>
    </div>
  );
}
