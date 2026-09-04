"use client";

import React, { useMemo, useCallback, type Ref } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AnimatedPopover } from "../ui/AnimatedPopover";
import { Tooltip } from "../ui/Tooltip";
import type { ToolInfo, ToolSelection } from "@/lib/shared/types";
import { expandToolPatterns } from "@/lib/shared/tool-selection";

/**
 * "Read only" quick preset — the canonical tool names pi's built-in
 * resource loader registers for file inspection. `setActiveToolsByName`
 * silently ignores names not present in `availableTools`, so a missing
 * tool (e.g. a stripped pi build without `grep`) just degrades the preset
 * to its intersection rather than failing outright.
 *
 * Re-exported so the parent (ChatInput) can derive its trigger label
 * ("Tools · Read only") and assemble the Read-only selection locally.
 */
export const READ_ONLY_TOOLS = ["find", "ls", "grep", "read"] as const;

/**
 * Named quick presets that map to a fixed list of tool names / prefix
 * patterns. `*`-suffixed entries (e.g. `codegraph_*`) are prefix patterns
 * resolved against the session's tool registry — either server-side when
 * the selection is applied (rpc-manager) or client-side against
 * `availableTools` (see `expandToolPatterns`). Unknown names are silently
 * ignored by pi's `setActiveToolsByName`, so a missing tool just degrades
 * the preset to its intersection rather than failing outright.
 */
export const TOOL_PRESET_PATTERNS = {
  read_only: READ_ONLY_TOOLS,
  minimal: ["bash", "read", "write", "edit", "ls", "find", "grep"],
  code: ["bash", "read", "write", "edit", "ls", "find", "grep", "agent_todo", "spawn_subagent", "codegraph_*", "pi_work_celebrate"],
  assistant: ["bash", "read", "write", "edit", "ls", "find", "grep", "pi_work_*", "show_media", "web_search", "fetch_content", "ask_user_questions"],
} as const satisfies Record<string, readonly string[]>;

export type NamedToolPresetId = keyof typeof TOOL_PRESET_PATTERNS;
export type ToolPresetId = "off" | "full" | NamedToolPresetId;

/** i18n keys for each named preset's row/trigger label. */
export const TOOL_PRESET_LABELS: Record<NamedToolPresetId, string> = {
  read_only: "Read only",
  minimal: "Minimal",
  code: "Coding",
  assistant: "Assistant",
};

/** i18n keys describing each named preset's tool set. */
export const TOOL_PRESET_DESCRIPTIONS: Record<NamedToolPresetId, string> = {
  read_only: "Find, ls, grep, read",
  minimal: "Pi's default tools",
  code: "Codegraph, todo list, and subagent capabilities",
  assistant: "Pi Work platform control capabilities",
};

/** i18n keys for the BottomToolbar trigger label of each named preset. */
export const TOOL_PRESET_TRIGGER_LABELS: Record<NamedToolPresetId, string> = {
  read_only: "Tools · Read only",
  minimal: "Tools · Minimal",
  code: "Tools · Coding",
  assistant: "Tools · Assistant",
};

/** Which named preset (if any) does this selection exactly match? */
export function matchNamedToolPreset(selection: ToolSelection): NamedToolPresetId | null {
  if (!Array.isArray(selection)) return null;
  for (const [id, patterns] of Object.entries(TOOL_PRESET_PATTERNS)) {
    if (selection.length === patterns.length && selection.every((name) => (patterns as readonly string[]).includes(name))) {
      return id as NamedToolPresetId;
    }
  }
  return null;
}

/**
 * Popover panel for the Tools button. Preset rows (Off / Full / Read only /
 * Minimal / Coding / Assistant) plus a Custom ▶ row that expands into a
 * per-tool checklist with auto-apply. Presets fire `onSelectPreset` and the
 * caller then closes the parent popover. The Custom row's expand state is owned
 * by the parent (`customExpanded`) so toggling tools inside doesn't dismiss
 * the panel between clicks.
 */
export function ToolsDropdownPanel({
  open,
  toolSelection,
  availableTools,
  toolsLoading,
  toolsError,
  customExpanded,
  panelRef,
  onSelectPreset,
  onToggleTool,
  onToggleCustomExpanded,
  onRetryEnsureTools: onRetryEnsureToolsProp,
}: {
  open: boolean;
  toolSelection: ToolSelection;
  availableTools: ToolInfo[];
  toolsLoading: boolean;
  toolsError: string | null;
  customExpanded: boolean;
  panelRef?: Ref<HTMLDivElement>;
  onSelectPreset: (preset: ToolPresetId) => void;
  onToggleTool: (selection: ToolSelection) => void;
  onToggleCustomExpanded: () => void;
  onRetryEnsureTools?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const allNames = useMemo(() => availableTools.map((tool) => tool.name), [availableTools]);
  // Checklist state: expand `*` patterns against the catalog so the per-tool
  // boxes reflect what a named pattern preset (e.g. Coding's `codegraph_*`)
  // actually enables. Toggling from this state collapses back to concrete
  // names, which the backend applies as-is.
  const selectedSet = useMemo(() => {
    if (toolSelection === "all") return new Set(allNames);
    return new Set(expandToolPatterns(Array.isArray(toolSelection) ? toolSelection : [], allNames));
  }, [toolSelection, allNames]);
  const isOff = Array.isArray(toolSelection) && toolSelection.length === 0;
  const isAll = toolSelection === "all";
  // "Read only" and the Minimal/Coding/Assistant presets are named quick
  // presets — fixed subsets (possibly with `*` prefix patterns) matched
  // exactly against the stored selection, so their row can highlight without
  // colliding with the generic Custom row (which would also match the
  // partial-array state).
  const namedPreset = matchNamedToolPreset(toolSelection);
  const isReadOnly = namedPreset === "read_only";
  // Generic Custom is "any partial selection that isn't a named preset".
  const isCustom = !isOff && !isAll && namedPreset === null;

  // Compute the next selection for one toggle click. Normalises full →
  // "all" sentinel so a future tool addition auto-includes; leaves the
  // empty array as `[]` (matches Off's wire shape).
  const toggleTool = useCallback(
    (name: string, willBeChecked: boolean) => {
      const next = new Set(selectedSet);
      if (willBeChecked) next.add(name);
      else next.delete(name);
      const newSelection: ToolSelection =
        next.size === allNames.length && allNames.length > 0
          ? "all"
          : Array.from(next);
      onToggleTool(newSelection);
    },
    [selectedSet, allNames, onToggleTool],
  );

  // Viewport-aware cap so the panel doesn't grow taller than the space
  // above the input. Matches ModelPicker/ModelDropdownPanel's approach.
  const viewportHeight = typeof window === "undefined" ? 720 : (window.visualViewport?.height ?? window.innerHeight);
  const maxH = Math.max(180, Math.min(viewportHeight * 0.6, 520));

  const customLabel = availableTools.length > 0
    ? t("Custom selection ({count}/{total})", { count: selectedSet.size, total: availableTools.length })
    : t("Custom selection");

  return (
    <AnimatedPopover
      open={open}
      maxHeight={maxH}
      panelRef={panelRef}
      style={{
        position: "absolute",
        bottom: "calc(100% + 6px)", right: 0,
        zIndex: 100,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
        width: 320,
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <PresetRow label={t("Off")} description={t("No tools, chat only")} isActive={isOff} onClick={() => onSelectPreset("off")} />
      <PresetRow label={t("Full")} description={t("All available tools")} isActive={isAll} onClick={() => onSelectPreset("full")} />
      <PresetRow label={t("Read only")} description={t(TOOL_PRESET_DESCRIPTIONS.read_only)} isActive={isReadOnly} onClick={() => onSelectPreset("read_only")} />
      <PresetRow label={t("Minimal")} description={t(TOOL_PRESET_DESCRIPTIONS.minimal)} isActive={namedPreset === "minimal"} onClick={() => onSelectPreset("minimal")} />
      <PresetRow label={t("Coding")} description={t(TOOL_PRESET_DESCRIPTIONS.code)} isActive={namedPreset === "code"} onClick={() => onSelectPreset("code")} />
      <PresetRow label={t("Assistant")} description={t(TOOL_PRESET_DESCRIPTIONS.assistant)} isActive={namedPreset === "assistant"} onClick={() => onSelectPreset("assistant")} />
      <button
        onClick={onToggleCustomExpanded}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          width: "100%", padding: "7px 12px",
          background: isCustom ? "var(--bg-selected)" : "none",
          border: "none",
          color: isCustom ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer", fontSize: 12, textAlign: "left",
          fontWeight: isCustom ? 600 : 400,
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          if (!isCustom) e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          if (!isCustom) e.currentTarget.style.background = "none";
        }}
      >
        {isCustom
          ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
          : <span style={{ width: 10, flexShrink: 0 }} />}
        <span style={{ flex: 1 }}>{customLabel}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0, transform: customExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="3 1 7 5 3 9" />
        </svg>
      </button>

      {customExpanded && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "4px 0", overflow: "auto", flex: 1, minHeight: 0 }}>
          {toolsLoading && (
            <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 8 }}>
              <InlineSpinner />
              {t("Loading tools...")}
            </div>
          )}
          {toolsError && !toolsLoading && (
            <div style={{ padding: "10px 12px", fontSize: 11, color: "#ef4444", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                {t("Failed to load tools")}: {toolsError}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Re-trigger the lazy fetch. ensureAvailableTools itself
                  // is idempotent on a non-error catalog, so a second click
                  // after success is a harmless no-op.
                  onRetryEnsureToolsProp?.();
                }}
                style={{ padding: "2px 8px", background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", cursor: "pointer", fontSize: 11 }}
              >
                {t("Retry")}
              </button>
            </div>
          )}
          {!toolsLoading && !toolsError && availableTools.length === 0 && (
            <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-dim)" }}>
              {t("No tools available for this session")}
            </div>
          )}
          {!toolsLoading && !toolsError && availableTools.length > 0 && (
            <div>
              {availableTools.map((tool) => {
                const isChecked = selectedSet.has(tool.name);
                return (
                  <Tooltip key={tool.name} content={tool.description} side="left">
                    <label
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "5px 12px",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                    >
                      <span style={{
                        width: 14, height: 14,
                        borderRadius: 3,
                        border: `1px solid ${isChecked ? "var(--accent)" : "var(--border)"}`,
                        background: isChecked ? "var(--accent)" : "var(--bg)",
                        flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {isChecked && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1.5 5 4 7.5 8.5 2.5" />
                          </svg>
                        )}
                      </span>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => toggleTool(tool.name, e.target.checked)}
                        aria-label={tool.name}
                        style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
                      />
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)", flexShrink: 0 }}>
                        {tool.name}
                      </span>
                      <span style={{
                        fontSize: 11,
                        color: "var(--text-dim)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                        flex: 1,
                      }}>
                        {tool.description}
                      </span>
                    </label>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </div>
      )}
    </AnimatedPopover>
  );
}

function PresetRow({ label, description, isActive, onClick }: {
  label: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        width: "100%", padding: "7px 12px",
        background: isActive ? "var(--bg-selected)" : "none",
        border: "none",
        color: isActive ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer", fontSize: 12, textAlign: "left",
        fontWeight: isActive ? 600 : 400,
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
    >
      {isActive
        ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
        : <span style={{ width: 10, flexShrink: 0 }} />}
      <span style={{ flex: 1 }}>{label}</span>
      <span title={description} style={{
        fontSize: 11, color: "var(--text-dim)", marginLeft: 8,
        maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{description}</span>
    </button>
  );
}

function InlineSpinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 12, height: 12,
        border: "1.5px solid color-mix(in srgb, var(--text-dim) 40%, transparent)",
        borderTopColor: "var(--text-muted)",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }}
    />
  );
}
