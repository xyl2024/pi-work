"use client";

import React, { useMemo, useCallback, type Ref } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AnimatedPopover } from "../ui/AnimatedPopover";
import { Tooltip } from "../ui/Tooltip";
import type { ToolInfo, ToolSelection } from "@/lib/shared/types";

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
 * Popover panel for the Tools button. 3-row layout (Off / Full / Read only)
 * plus a Custom ▶ row that expands into a per-tool checklist with auto-apply.
 * Off and Full are 1-click presets that fire `onSelectPreset` and the caller
 * then closes the parent popover. The Custom row's expand state is owned
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
  onSelectPreset: (preset: "off" | "full" | "read_only") => void;
  onToggleTool: (selection: ToolSelection) => void;
  onToggleCustomExpanded: () => void;
  onRetryEnsureTools?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const allNames = useMemo(() => availableTools.map((tool) => tool.name), [availableTools]);
  const selectedSet = useMemo(() => {
    if (toolSelection === "all") return new Set(allNames);
    return new Set(Array.isArray(toolSelection) ? toolSelection : []);
  }, [toolSelection, allNames]);
  const isOff = Array.isArray(toolSelection) && toolSelection.length === 0;
  const isAll = toolSelection === "all";
  // "Read only" is a named quick preset — a fixed subset of file-inspection
  // tools. Detect it here so the row can highlight without colliding with
  // the generic Custom row (which would also match the partial-array state).
  const isReadOnly = Array.isArray(toolSelection)
    && toolSelection.length === READ_ONLY_TOOLS.length
    && toolSelection.every((name) => (READ_ONLY_TOOLS as readonly string[]).includes(name));
  // Generic Custom is "any partial selection that isn't a named preset".
  const isCustom = !isOff && !isAll && !isReadOnly;

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
      <PresetRow label={t("Read only")} description={t("Find, ls, grep, read")} isActive={isReadOnly} onClick={() => onSelectPreset("read_only")} />
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
      <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{description}</span>
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
