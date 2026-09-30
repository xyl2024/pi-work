"use client";

/**
 * SubagentToolPicker — chooses a profile's tool set from the live tool catalog.
 *
 * Mirrors the cwd tools picker (`components/sessions/CwdToolsPicker.tsx`): a
 * search box, preset cards, and a checkbox grid. Selections are stored as
 * concrete tool names, so patterns are expanded against the catalog before they
 * are handed back.
 */

import { useEffect, useMemo, useState } from "react";
import { ToolCheckRow, ToolPresetCard } from "@/components/ui/ToolPicker";
import { Tooltip } from "@/components/ui/Tooltip";
import { useI18n } from "@/hooks/useI18n";
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
  type NamedToolPresetId,
} from "@/components/chat/ToolsPickerModal";

/** The pattern a new subagent profile starts from: read-only core + shells. */
export const SUBAGENT_DEFAULT_TOOL_PATTERN: readonly string[] = [
  "read",
  "grep",
  "ls",
  "find",
  "codegraph_*",
  "bash",
  "powershell",
];

interface ToolCatalogEntry {
  name: string;
  description?: string | null;
}

export function SubagentToolPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tools: string[]) => void;
}) {
  const { t } = useI18n();
  const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cwdResponse = await fetch("/api/default-cwd", { method: "POST" });
        const cwdData = await cwdResponse.json() as { cwd?: string };
        if (!cwdData.cwd) throw new Error("no cwd");
        const response = await fetch("/api/agent/tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: cwdData.cwd }),
        });
        const data = await response.json() as { data?: { available?: ToolCatalogEntry[] } };
        if (!cancelled) setTools(data.data?.available ?? []);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const allNames = useMemo(() => tools.map((tool) => tool.name), [tools]);
  const rows = useMemo(
    () => buildToolChecklistRows(tools, (count) => t("Bound tool family — toggled together ({count} tools)", { count })),
    [tools, t],
  );
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((row) => `${row.name} ${row.description ?? ""}`.toLowerCase().includes(q)) : rows;
  }, [query, rows]);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const presets = useMemo(() => {
    const named = (Object.keys(TOOL_PRESET_PATTERNS) as NamedToolPresetId[]).map((id) => ({
      id: `preset:${id}`,
      label: t(TOOL_PRESET_LABELS[id]),
      description: t(TOOL_PRESET_DESCRIPTIONS[id]),
    }));
    return [
      { id: "off", label: t("Off"), description: t("No tools, chat only") },
      { id: "full", label: t("Full"), description: t("All available tools") },
      { id: "subagent-default", label: t("Read only + shells"), description: t("Read, grep, ls, find, CodeGraph and shells") },
      ...named,
    ];
  }, [t]);

  const applyPreset = (id: string) => {
    if (id === "off") { onChange([]); return; }
    if (id === "full") { onChange([...allNames]); return; }
    if (id === "subagent-default") { onChange(expandToolPatterns(SUBAGENT_DEFAULT_TOOL_PATTERN, allNames)); return; }
    const preset = id.replace(/^preset:/, "") as NamedToolPresetId;
    onChange(expandToolPatterns(TOOL_PRESET_PATTERNS[preset], allNames));
  };

  const toggleTool = (name: string, checked: boolean) => {
    const next = toggleSelectionEntry(value, name, checked, allNames);
    onChange(expandToolPatterns(next, allNames));
  };

  if (loading) {
    return <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "10px 0" }}>{t("Loading...")}</div>;
  }
  if (failed) {
    return <div style={{ fontSize: 12, color: "var(--error)", padding: "10px 0" }}>{t("Failed to load tools")}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
        {presets.map((preset) => (
          <ToolPresetCard
            key={preset.id}
            label={preset.label}
            description={preset.description}
            active={false}
            onClick={() => applyPreset(preset.id)}
          />
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search tools...")}
          spellCheck={false}
          style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
        />
        <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>{selectedSet.size}/{tools.length}</span>
      </div>

      <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 6 }} data-hide-v-scrollbar>
        {filteredRows.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
            {tools.length ? t("No matches") : t("No tools available")}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 5 }}>
            {filteredRows.map((row) => {
              const checked = isToolChecklistRowChecked(row, selectedSet, allNames);
              const item = (
                <ToolCheckRow
                  key={row.key}
                  name={row.name}
                  checked={checked}
                  memberCount={row.group && row.memberCount > 0 ? row.memberCount : 0}
                  onChange={(next) => toggleTool(row.name, next)}
                />
              );
              return row.description
                ? <Tooltip key={row.key} content={row.description} side="top">{item}</Tooltip>
                : item;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
