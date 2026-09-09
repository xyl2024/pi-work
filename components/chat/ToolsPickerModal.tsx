"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "@/components/ui/Tooltip";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import type { ToolInfo, ToolSelection } from "@/lib/shared/types";
import {
  buildToolChecklistRows,
  expandToolPatterns,
  isToolChecklistRowChecked,
  toggleSelectionEntry,
} from "@/lib/shared/tool-selection";

export const READ_ONLY_TOOLS = ["find", "ls", "grep", "read"] as const;

export const TOOL_PRESET_PATTERNS = {
  read_only: READ_ONLY_TOOLS,
  minimal: ["bash", "read", "write", "edit", "ls", "find", "grep"],
  code: ["bash", "read", "write", "edit", "ls", "find", "grep", "agent_todo", "spawn_subagent", "codegraph_*", "pi_work_celebrate"],
  assistant: ["bash", "read", "write", "edit", "ls", "find", "grep", "pi_work_*", "show_media", "web_search", "fetch_content", "ask_user_questions"],
} as const satisfies Record<string, readonly string[]>;

export type NamedToolPresetId = keyof typeof TOOL_PRESET_PATTERNS;
export type ToolPresetId = "off" | "full" | NamedToolPresetId;

export const TOOL_PRESET_LABELS: Record<NamedToolPresetId, string> = {
  read_only: "Read only", minimal: "Minimal", code: "Coding", assistant: "Assistant",
};

export const TOOL_PRESET_DESCRIPTIONS: Record<NamedToolPresetId, string> = {
  read_only: "Find, ls, grep, read", minimal: "Pi's default tools",
  code: "Codegraph, todo list, and subagent capabilities",
  assistant: "Pi Work platform control capabilities",
};

export const TOOL_PRESET_TRIGGER_LABELS: Record<NamedToolPresetId, string> = {
  read_only: "Tools · Read only", minimal: "Tools · Minimal",
  code: "Tools · Coding", assistant: "Tools · Assistant",
};

export function matchNamedToolPreset(selection: ToolSelection): NamedToolPresetId | null {
  if (!Array.isArray(selection)) return null;
  for (const [id, patterns] of Object.entries(TOOL_PRESET_PATTERNS)) {
    if (selection.length === patterns.length && selection.every((name) => (patterns as readonly string[]).includes(name))) {
      return id as NamedToolPresetId;
    }
  }
  return null;
}

type PresetOption = { id: ToolPresetId; label: string; description: string };

export function ToolsPickerModal({
  open, toolSelection, availableTools, toolsLoading, toolsError,
  onSelectPreset, onToggleTool, onRetryEnsureTools, onClose,
}: {
  open: boolean;
  toolSelection: ToolSelection;
  availableTools: ToolInfo[];
  toolsLoading: boolean;
  toolsError: string | null;
  onSelectPreset: (preset: ToolPresetId) => void;
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
  const itemRefs = useRef<(HTMLButtonElement | HTMLLabelElement | null)[]>([]);
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

  const presets = useMemo<PresetOption[]>(() => [
    { id: "off", label: t("Off"), description: t("No tools, chat only") },
    { id: "full", label: t("Full"), description: t("All available tools") },
    ...Object.keys(TOOL_PRESET_PATTERNS).map((id) => ({
      id: id as NamedToolPresetId,
      label: t(TOOL_PRESET_LABELS[id as NamedToolPresetId]),
      description: t(TOOL_PRESET_DESCRIPTIONS[id as NamedToolPresetId]),
    })),
  ], [t]);
  const namedPreset = matchNamedToolPreset(toolSelection);
  const presetActive = (id: ToolPresetId) => id === "off"
    ? Array.isArray(toolSelection) && toolSelection.length === 0
    : id === "full" ? toolSelection === "all" : namedPreset === id;

  useEffect(() => {
    setPortalEl(document.body);
  }, []);
  useEffect(() => {
    if (!open) {
      openFetchRef.current = false;
      return;
    }
    setQuery("");
    // Default focus: the currently active preset (off/full/named); custom selections start at 0.
    if (toolSelection === "all") setActiveIndex(1);
    else if (Array.isArray(toolSelection) && toolSelection.length === 0) setActiveIndex(0);
    else {
      const named = matchNamedToolPreset(toolSelection);
      const presetKeys = ["off", "full", ...Object.keys(TOOL_PRESET_PATTERNS)];
      const idx = named ? presetKeys.indexOf(named) : -1;
      setActiveIndex(idx >= 0 ? idx : 0);
    }
    if (!openFetchRef.current && !availableTools.length && !toolsLoading) {
      openFetchRef.current = true;
      void onRetryEnsureTools?.();
    }
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // toolSelection is intentionally read-only here: re-running on change would reset keyboard focus mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, availableTools.length, toolsLoading, onRetryEnsureTools]);
  useEffect(() => {
    if (!isVisible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); requestClose(); return; }
      if (phase !== "open") return;
      const itemCount = presets.length + filteredRows.length;
      if (!itemCount) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        setActiveIndex((index) => {
          const delta = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
          return (index + delta + itemCount) % itemCount;
        });
      }
      if (e.key === "Enter") {
        const index = activeIndex;
        if (index < presets.length) {
          e.preventDefault();
          onSelectPreset(presets[index].id);
          requestClose();
        } else {
          const row = filteredRows[index - presets.length];
          if (row) {
            e.preventDefault();
            const checked = isToolChecklistRowChecked(row, selectedSet, allNames);
            onToggleTool(toggleSelectionEntry(toolSelection === "all" ? [...allNames] : Array.isArray(toolSelection) ? [...toolSelection] : [], row.name, !checked, allNames));
          }
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isVisible, phase, requestClose, activeIndex, presets, filteredRows, selectedSet, allNames, toolSelection, onSelectPreset, onToggleTool]);
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
        <div style={{ padding: "0 14px 10px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" }}>
            <span style={{ color: "var(--text-dim)", fontSize: 12 }}>⌕</span>
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search tools...")} spellCheck={false} style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13, padding: "8px 2px" }} />
          </div>
        </div>
        <div style={{ padding: "0 14px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
            {presets.map((preset, index) => <PresetCard key={preset.id} ref={(el) => { itemRefs.current[index] = el; }} preset={preset} active={presetActive(preset.id)} focused={activeIndex === index} onClick={() => { onSelectPreset(preset.id); requestClose(); }} />)}
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
            : <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>{filteredRows.map((row, index) => {
              const itemIndex = presets.length + index;
              const checked = isToolChecklistRowChecked(row, selectedSet, allNames);
              const label = <label key={row.key} ref={(el) => { itemRefs.current[itemIndex] = el; }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: `1px solid ${activeIndex === itemIndex ? "var(--accent)" : "var(--border)"}`, borderRadius: 7, background: checked ? "var(--bg-selected)" : "var(--bg)", cursor: "pointer", fontSize: 12 }}>
                <input type="checkbox" checked={checked} onChange={(e) => toggleTool(row.name, e.target.checked)} style={{ accentColor: "var(--accent)" }} />
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                {row.group && <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>×{row.memberCount}</span>}
              </label>;
              return row.description ? <Tooltip key={row.key} content={row.description} side="top">{label}</Tooltip> : label;
            })}</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", borderTop: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 11, flexShrink: 0 }}><span>{t("Arrow keys select · Enter confirm · Esc close")}</span><span>{isOff ? t("No tools") : toolSelection === "all" ? t("All tools") : t("Custom")}</span></div>
      </div>
    </div>,
    portalEl,
  );
}

import { forwardRef } from "react";
const PresetCard = forwardRef<HTMLButtonElement, { preset: PresetOption; active: boolean; focused: boolean; onClick: () => void }>(function PresetCard({ preset, active, focused, onClick }, ref) {
  return <button ref={ref} type="button" onClick={onClick} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, minWidth: 0, minHeight: 58, padding: "8px 9px", textAlign: "left", background: active ? "var(--bg-selected)" : "var(--bg)", border: `1px solid ${focused || active ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, color: active ? "var(--text)" : "var(--text-muted)", cursor: "pointer" }}>
    <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: active ? 600 : 400 }}>{active ? "✓" : "○"} {preset.label}</span>
    <span style={{ width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10 }}>{preset.description}</span>
  </button>;
});

function InlineSpinner() {
  return <span aria-hidden="true" style={{ display: "inline-block", width: 12, height: 12, border: "1.5px solid color-mix(in srgb, var(--text-dim) 40%, transparent)", borderTopColor: "var(--text-muted)", borderRadius: "50%", animation: "spin 0.8s linear infinite", verticalAlign: "middle" }} />;
}
