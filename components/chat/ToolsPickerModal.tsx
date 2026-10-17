"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "@/components/ui/Tooltip";
import { ToolCheckRow } from "@/components/ui/ToolPicker";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import type { ToolInfo, ToolSelection } from "@/lib/shared/types";
import {
  buildToolChecklistRows,
  expandToolPatterns,
  isToolChecklistRowChecked,
  toggleSelectionEntry,
} from "@/lib/shared/tool-selection";

export function ToolsPickerModal({
  open, toolSelection, availableTools, toolsLoading, toolsError,
  onToggleTool, onRetryEnsureTools, onClose,
}: {
  open: boolean;
  toolSelection: ToolSelection;
  availableTools: ToolInfo[];
  toolsLoading: boolean;
  toolsError: string | null;
  onToggleTool: (selection: ToolSelection) => void;
  onRetryEnsureTools?: () => Promise<void>;
  onClose: () => void;
  /** Legacy props accepted while callers migrate from the dropdown API. */
  customExpanded?: boolean;
  panelRef?: Ref<HTMLDivElement>;
  onToggleCustomExpanded?: () => void;
}) {
  const { t } = useI18n();
  const { requestClose, backdropStyle, panelStyle, isVisible, phase } = useModalAnimation({
    isOpen: open, onClose, backdropAlpha: 0.35,
  });
  useBodyScrollLock(isVisible);

  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<(HTMLLabelElement | null)[]>([]);
  const openFetchRef = useRef(false);

  const allNames = useMemo(() => availableTools.map((tool) => tool.name), [availableTools]);
  const rows = useMemo(
    () => buildToolChecklistRows(availableTools, (count) => t("Bound tool family — toggled together ({count} tools)", { count })),
    [availableTools, t],
  );
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((row) => `${row.name} ${row.description}`.toLowerCase().includes(q)) : rows;
  }, [query, rows]);
  const selectedSet = useMemo(() => {
    if (toolSelection === "all") return new Set(allNames);
    return new Set(expandToolPatterns(Array.isArray(toolSelection) ? toolSelection : [], allNames));
  }, [toolSelection, allNames]);

  useEffect(() => {
    setPortalEl(document.body);
  }, []);
  useEffect(() => {
    if (!open) {
      openFetchRef.current = false;
      return;
    }
    setQuery("");
    setActiveIndex(0);
    if (!openFetchRef.current && !availableTools.length && !toolsLoading) {
      openFetchRef.current = true;
      void onRetryEnsureTools?.();
    }
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, availableTools.length, toolsLoading, onRetryEnsureTools]);
  useEffect(() => {
    if (!isVisible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); requestClose(); return; }
      if (phase !== "open") return;
      const itemCount = filteredRows.length;
      if (!itemCount) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        setActiveIndex((index) => {
          const delta = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
          return (index + delta + itemCount) % itemCount;
        });
      }
      if (e.key === "Enter") {
        const row = filteredRows[activeIndex];
        if (row) {
          e.preventDefault();
          const checked = isToolChecklistRowChecked(row, selectedSet, allNames);
          onToggleTool(toggleSelectionEntry(toolSelection === "all" ? [...allNames] : Array.isArray(toolSelection) ? [...toolSelection] : [], row.name, !checked, allNames));
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isVisible, phase, requestClose, activeIndex, filteredRows, selectedSet, allNames, toolSelection, onToggleTool]);
  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const toggleTool = useCallback((name: string, checked: boolean) => {
    if (phase !== "open") return;
    const raw = toolSelection === "all" ? [...allNames] : Array.isArray(toolSelection) ? [...toolSelection] : [];
    const next = toggleSelectionEntry(raw, name, checked, allNames);
    const expanded = expandToolPatterns(next, allNames);
    onToggleTool(expanded.length === allNames.length && allNames.length > 0 ? "all" : next);
  }, [phase, toolSelection, allNames, onToggleTool]);

  if (!isVisible || !portalEl) return null;
  const isOff = Array.isArray(toolSelection) && toolSelection.length === 0;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t("Choose tools")} style={backdropStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div style={{ ...panelStyle, width: "min(760px, calc(100vw - 32px))", maxHeight: "min(680px, calc(100vh - 64px))", display: "flex", flexDirection: "column", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.22)", overflow: "hidden" }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px", flexShrink: 0 }}>
          <span style={{ flex: 1, color: "var(--text)", fontSize: 13, fontWeight: 600 }}>{t("Choose tools")}</span>
          <button type="button" onClick={requestClose} aria-label={t("Close")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, background: "none", border: "none", borderRadius: 6, color: "var(--text-dim)", cursor: "pointer" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="4" x2="20" y2="20" /><line x1="20" y1="4" x2="4" y2="20" /></svg>
          </button>
        </div>
        <div style={{ padding: "0 14px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" }}>
            <span style={{ color: "var(--text-dim)", fontSize: 12 }}>⌕</span>
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search tools...")} spellCheck={false} style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13, padding: "8px 2px" }} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px 6px", flexShrink: 0 }}>
          <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 600 }}>{t("Custom selection")}</span>
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{selectedSet.size}/{availableTools.length}</span>
        </div>
        <div style={{ flex: 1, minHeight: 80, overflowY: "auto", padding: "0 14px 10px" }} data-hide-v-scrollbar>
          {toolsLoading ? <div style={{ padding: 20, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}><InlineSpinner /> {t("Loading tools...")}</div>
            : toolsError ? <div style={{ padding: 16, color: "#ef4444", fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}><span style={{ flex: 1 }}>{t("Failed to load tools")}: {toolsError}</span><button type="button" onClick={() => void onRetryEnsureTools?.()}>{t("Retry")}</button></div>
            : filteredRows.length === 0 ? <div style={{ padding: 20, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>{availableTools.length ? t("No matches") : t("No tools available for this session")}</div>
            : <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 7 }}>{filteredRows.map((row, index) => {
              const checked = isToolChecklistRowChecked(row, selectedSet, allNames);
              const item = (
                <ToolCheckRow
                  key={row.key}
                  ref={(el) => { itemRefs.current[index] = el; }}
                  name={row.name}
                  checked={checked}
                  focused={activeIndex === index}
                  memberCount={row.group ? row.memberCount : 0}
                  onChange={(v) => toggleTool(row.name, v)}
                />
              );
              return row.description ? <Tooltip key={row.key} content={row.description} side="top">{item}</Tooltip> : item;
            })}</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", borderTop: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 11, flexShrink: 0 }}><span>{t("Arrow keys select · Enter confirm · Esc close")}</span><span>{isOff ? t("No tools") : toolSelection === "all" ? t("All tools") : t("Custom")}</span></div>
      </div>
    </div>,
    portalEl,
  );
}

function InlineSpinner() {
  return <span aria-hidden="true" style={{ display: "inline-block", width: 12, height: 12, border: "1.5px solid color-mix(in srgb, var(--text-dim) 40%, transparent)", borderTopColor: "var(--text-muted)", borderRadius: "50%", animation: "spin 0.8s linear infinite", verticalAlign: "middle" }} />;
}
