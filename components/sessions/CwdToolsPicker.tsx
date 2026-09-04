"use client";

import { useEffect, useState } from "react";
import type { ToolSelection } from "@/lib/shared/types";
import { expandToolPatterns } from "@/lib/shared/tool-selection";
import { TOOL_PRESET_PATTERNS, TOOL_PRESET_LABELS, TOOL_PRESET_DESCRIPTIONS, type NamedToolPresetId } from "@/components/chat/ToolsDropdownPanel";
import { useI18n } from "@/hooks/useI18n";

export function CwdToolsPicker({ cwd, open, onClose }: { cwd: string; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [tools, setTools] = useState<{ name: string; description: string }[]>([]);
  const [selection, setSelection] = useState<ToolSelection>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  if (!open) return null;
  // `selection` may contain trailing-`*` prefix patterns when a named preset
  // is active (they are stored raw so the chat tools picker can recognise the
  // preset); expand them against the catalog for the checkbox display.
  const toolNames = tools.map((tool) => tool.name);
  const selected = selection === "all"
    ? new Set(toolNames)
    : new Set(expandToolPatterns(Array.isArray(selection) ? selection : [], toolNames));
  // Named presets are stored raw (patterns included) — the server expands
  // them when a session starts, and the chat tools picker matches the raw
  // list to highlight the preset.
  const applyPreset = (id: NamedToolPresetId) => {
    setSelection([...TOOL_PRESET_PATTERNS[id]]);
  };
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/cwd-tools", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, selection }) });
      if (!res.ok) throw new Error("save failed");
      window.dispatchEvent(new CustomEvent("cwd-tools-changed", { detail: { cwd } }));
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" style={{ width: 380, maxHeight: "80vh", overflow: "auto", padding: 18, borderRadius: 10, background: "var(--bg-panel)", border: "1px solid var(--border)", boxShadow: "0 12px 40px rgba(0,0,0,.35)" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>{t("Default tools for this project")}</h3>
        <p style={{ margin: "0 0 14px", color: "var(--text-muted)", fontSize: 11, wordBreak: "break-all" }}>{cwd}</p>
        {loading ? <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("Loading...")}</div> : <>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button onClick={() => setSelection("all")} style={{ flex: 1 }}>{t("All tools")}</button>
            <button onClick={() => setSelection([])} style={{ flex: 1 }}>{t("Off")}</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {(Object.keys(TOOL_PRESET_PATTERNS) as NamedToolPresetId[]).map((id) => (
              <button key={id} onClick={() => applyPreset(id)} style={{ flex: 1 }} title={t(TOOL_PRESET_DESCRIPTIONS[id])}>{t(TOOL_PRESET_LABELS[id])}</button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {tools.map((tool) => <label key={tool.name} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
              <input type="checkbox" checked={selected.has(tool.name)} onChange={() => {
                // Toggling a single tool collapses pattern entries back to
                // concrete names (same behaviour as the chat tools picker).
                const next = new Set(selected);
                if (next.has(tool.name)) next.delete(tool.name); else next.add(tool.name);
                setSelection(Array.from(next));
              }} />
              <span>{tool.name}</span>
            </label>)}
          </div>
        </>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose}>{t("Cancel")}</button>
          <button onClick={() => void save()} disabled={loading || saving} style={{ background: "var(--accent)", color: "white", border: 0, borderRadius: 5, padding: "6px 12px" }}>{t("Save")}</button>
        </div>
      </div>
    </div>
  );
}
