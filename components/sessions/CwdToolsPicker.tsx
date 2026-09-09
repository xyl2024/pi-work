"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "@/components/ui/Tooltip";
import { ToolCheckRow, ToolPresetCard } from "@/components/ui/ToolPicker";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import type { ToolSelection } from "@/lib/shared/types";
import {
  buildToolChecklistRows,
  expandToolPatterns,
  isToolChecklistRowChecked,
  toggleSelectionEntry,
} from "@/lib/shared/tool-selection";
import {
  TOOL_PRESET_PATTERNS,
  TOOL_PRESET_LABELS,
  TOOL_PRESET_DESCRIPTIONS,
  matchNamedToolPreset,
  type NamedToolPresetId,
} from "@/components/chat/ToolsPickerModal";

/**
 * Modal to configure the *default* tool set a cwd starts new sessions with
 * (persisted per-cwd via `/api/cwd-tools`). Its chrome mirrors the chat
 * tools picker (ToolsPickerModal) / model & project pickers: portal +
 * modal animation, a search box, a preset-card grid, and a live checkbox
 * grid for the custom selection.
 *
 * Unlike the in-session tools picker this is a *setting*, so the selection
 * is staged locally and only persisted on Save; presets stage without
 * closing so the user can refine before committing. The change takes effect
 * on sessions started afterwards (the server reads the cwd default at
 * session start).
 */
export function CwdToolsPicker({ cwd, open, onClose }: { cwd: string; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { requestClose, backdropStyle, panelStyle, isVisible, phase } = useModalAnimation({
    isOpen: open,
    onClose,
    backdropAlpha: 0.35,
  });
  useBodyScrollLock(isVisible);

  const [tools, setTools] = useState<{ name: string; description?: string | null }[]>([]);
  const [selection, setSelection] = useState<ToolSelection>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | HTMLLabelElement | null)[]>([]);
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  useEffect(() => { setPortalEl(document.body); }, []);

  // Fetch the current default selection + the tool catalog for this cwd.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/cwd-tools?cwd=${encodeURIComponent(cwd)}`).then((r) => r.json()),
      fetch("/api/agent/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd }) }).then((r) => r.json()),
    ]).then(([config, catalog]) => {
      setSelection(config.selection ?? "all");
      setTools(catalog.data?.available ?? []);
    }).finally(() => setLoading(false));
  }, [cwd, open]);

  const allNames = useMemo(() => tools.map((tool) => tool.name), [tools]);
  const rows = useMemo(
    () => buildToolChecklistRows(tools, (count) => t("Bound tool family — toggled together ({count} tools)", { count })),
    [tools, t],
  );
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? rows.filter((row) => `${row.name} ${row.description ?? ""}`.toLowerCase().includes(q))
      : rows;
  }, [query, rows]);

  // The raw selection we operate on: explicit names/patterns, or (for
  // "all") the full catalog expanded to concrete names.
  const raw = useMemo<string[]>(
    () => selection === "all" ? [...allNames] : Array.isArray(selection) ? [...selection] : [],
    [selection, allNames],
  );
  const selectedSet = useMemo(() => {
    if (selection === "all") return new Set(allNames);
    return new Set(expandToolPatterns(Array.isArray(selection) ? selection : [], allNames));
  }, [selection, allNames]);

  // Preset cards, mirroring the chat tools picker: Off / Full / named.
  const presets = useMemo(() => {
    const named = (Object.keys(TOOL_PRESET_PATTERNS) as NamedToolPresetId[]).map((id) => ({
      id: `preset:${id}`,
      label: t(TOOL_PRESET_LABELS[id]),
      description: t(TOOL_PRESET_DESCRIPTIONS[id]),
    }));
    return [
      { id: "off", label: t("Off"), description: t("No tools, chat only") },
      { id: "full", label: t("Full"), description: t("All available tools") },
      ...named,
    ];
  }, [t]);

  const matchedPreset = useMemo<NamedToolPresetId | null>(() => {
    if (!Array.isArray(selection)) return null;
    return matchNamedToolPreset(selection);
  }, [selection]);

  const activePresetId = useMemo(() => {
    if (selection === "all") return "full";
    if (Array.isArray(selection) && selection.length === 0) return "off";
    return matchedPreset ? `preset:${matchedPreset}` : null;
  }, [selection, matchedPreset]);

  const presetActive = (id: string) => activePresetId === id;

  // Fresh modal per open: clear search, reset the active row and focus the
  // input. Since this modal is conditionally mounted (open === true while
  // alive) the open edge effectively happens once on mount.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // The search box is inside the `!loading` branch, so it does not exist
  // during the mount focus pass above — refocus once the catalog is loaded.
  useEffect(() => {
    if (loading || !isVisible) return;
    inputRef.current?.focus();
  }, [loading, isVisible]);

  // Reset navigation when the list filters change so Enter stays in range.
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, presets.length + filteredRows.length - 1)));
  }, [presets.length, filteredRows.length]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const applyPreset = useCallback((id: string) => {
    if (phase !== "open") return;
    if (id === "off") setSelection([]);
    else if (id === "full") setSelection("all");
    else {
      const preset = id.replace(/^preset:/, "") as NamedToolPresetId;
      setSelection([...TOOL_PRESET_PATTERNS[preset]]);
    }
  }, [phase]);

  const toggleTool = useCallback((name: string, checked: boolean) => {
    if (phase !== "open") return;
    const next = toggleSelectionEntry(raw, name, checked, allNames);
    const expanded = expandToolPatterns(next, allNames);
    setSelection(expanded.length === allNames.length && allNames.length > 0 ? "all" : next);
  }, [phase, raw, allNames]);

  // Document-level keyboard: ↑↓/←→ move, Enter confirm, Esc close.
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
      } else if (e.key === "Enter") {
        const index = activeIndex;
        if (index < presets.length) {
          e.preventDefault();
          applyPreset(presets[index].id);
        } else {
          const row = filteredRows[index - presets.length];
          if (row) {
            e.preventDefault();
            const checked = isToolChecklistRowChecked(row, selectedSet, allNames);
            toggleTool(row.name, !checked);
          }
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isVisible, phase, requestClose, activeIndex, presets, filteredRows, selectedSet, allNames, applyPreset, toggleTool]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/cwd-tools", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, selection }) });
      if (!res.ok) throw new Error("save failed");
      window.dispatchEvent(new CustomEvent("cwd-tools-changed", { detail: { cwd } }));
      requestClose();
    } finally { setSaving(false); }
  };

  if (!isVisible || !portalEl) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t("Default tools for this project")} style={backdropStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div style={{ ...panelStyle, width: "min(760px, calc(100vw - 32px))", maxHeight: "min(680px, calc(100vh - 64px))", display: "flex", flexDirection: "column", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.22)", overflow: "hidden" }} onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 2px", flexShrink: 0 }}>
          <span style={{ flex: 1, color: "var(--text)", fontSize: 13, fontWeight: 600 }}>{t("Default tools for this project")}</span>
          <button type="button" onClick={requestClose} aria-label={t("Close")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, background: "none", border: "none", borderRadius: 6, color: "var(--text-dim)", cursor: "pointer" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="4" x2="20" y2="20" /><line x1="20" y1="4" x2="4" y2="20" /></svg>
          </button>
        </div>
        {/* Project path caption */}
        <div style={{ padding: "0 14px 10px", flexShrink: 0 }}>
          <div title={cwd} style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cwd}</div>
        </div>

        {loading ? (
          <div style={{ padding: "40px 20px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}><InlineSpinner /> {t("Loading...")}</div>
        ) : (
          <>
            {/* Search */}
            <div style={{ padding: "0 14px 10px", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" }}>
                <span style={{ color: "var(--text-dim)", fontSize: 12 }}>⌕</span>
                <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search tools...")} spellCheck={false} style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13, padding: "8px 2px" }} />
              </div>
            </div>

            {/* Presets */}
            <div style={{ padding: "0 14px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 7 }}>
                {presets.map((preset, index) => (
                  <ToolPresetCard
                    key={preset.id}
                    ref={(el) => { itemRefs.current[index] = el; }}
                    label={preset.label}
                    description={preset.description}
                    active={presetActive(preset.id)}
                    focused={activeIndex === index}
                    onClick={() => applyPreset(preset.id)}
                  />
                ))}
              </div>
            </div>

            {/* Custom checklist */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px 6px", flexShrink: 0 }}>
              <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 600 }}>{t("Custom selection")}</span>
              <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{selectedSet.size}/{tools.length}</span>
            </div>
            <div style={{ flex: 1, minHeight: 120, overflowY: "auto", padding: "0 14px 10px" }} data-hide-v-scrollbar>
              {filteredRows.length === 0 ? (
                <div style={{ padding: 20, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>{tools.length ? t("No matches") : t("No tools available")}</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 7 }}>
                  {filteredRows.map((row, index) => {
                    const itemIndex = presets.length + index;
                    const checked = isToolChecklistRowChecked(row, selectedSet, allNames);
                    const item = (
                      <ToolCheckRow
                        key={row.key}
                        ref={(el) => { itemRefs.current[itemIndex] = el; }}
                        name={row.name}
                        checked={checked}
                        focused={activeIndex === itemIndex}
                        memberCount={row.group && row.memberCount > 0 ? row.memberCount : 0}
                        onChange={(v) => toggleTool(row.name, v)}
                      />
                    );
                    return row.description ? <Tooltip key={row.key} content={row.description} side="top">{item}</Tooltip> : item;
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 14px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{t("Arrow keys select · Enter confirm · Esc close")}</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" onClick={requestClose} disabled={loading || saving} style={{ padding: "5px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text)", fontSize: 12, cursor: "pointer" }}>{t("Cancel")}</button>
            <button type="button" onClick={() => void save()} disabled={loading || saving} style={{ padding: "5px 14px", background: "var(--accent)", border: "none", borderRadius: 7, color: "white", fontSize: 12, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: loading || saving ? 0.6 : 1 }}>{saving ? t("Saving...") : t("Save")}</button>
          </div>
        </div>
      </div>
    </div>,
    portalEl,
  );
}

function InlineSpinner() {
  return <span aria-hidden="true" style={{ display: "inline-block", width: 12, height: 12, border: "1.5px solid color-mix(in srgb, var(--text-dim) 40%, transparent)", borderTopColor: "var(--text-muted)", borderRadius: "50%", animation: "spin 0.8s linear infinite", verticalAlign: "middle" }} />;
}
