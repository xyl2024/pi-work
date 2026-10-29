"use client";

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AnimatedPopover } from "@/components/ui/AnimatedPopover";
import { ProviderIcon, ProviderGearIcon, resolveProviderIcon } from "@/components/ui/icons";
import { ModelPickerModal } from "@/components/chat/ModelPickerModal";
import { ToolsPickerModal } from "@/components/chat/ToolsPickerModal";
import { pickClosestAvailableThinkingLevel, THINKING_LEVEL_ORDER } from "@/lib/shared/thinking-level-utils";
import { expandToolPatterns } from "@/lib/shared/tool-selection";
import type { SchedulerModelMeta, SchedulerTaskForm } from "@/lib/shared/scheduler";
import type { ToolInfo } from "@/lib/shared/types";
import { CheckIcon, LightbulbIcon, ToolIcon } from "@/components/ui/icons";
import { fieldErrorStyle, fieldHintStyle, fieldLabelStyle } from "@/components/scheduler/styles";

/**
 * Form primitives for the scheduler form page.
 *
 * The model / thinking / tools controls reuse the chat input bar's pill
 * language (a borderless rounded trigger that opens the shared application
 * dialog), so the scheduler does not grow a second model / tool / directory
 * picker. They are split out of the page itself so the page reads as a layout,
 * not a wall of controls.
 */

/** Trigger pill matching the chat input bar's model / thinking / tools buttons. */
export function pillTriggerStyle(open: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    height: 32,
    padding: "0 10px",
    boxSizing: "border-box",
    background: open ? "var(--bg-hover)" : "none",
    border: "1px solid var(--border)",
    borderRadius: 9,
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "inherit",
    transition: "background 0.12s, color 0.12s",
    overflow: "hidden",
  };
}

/** Dropdown panel chrome matching the chat input's popover panels. */
export const dropdownPanelStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  left: 0,
  right: 0,
  zIndex: 1100,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
};

/** Option row matching the chat input dropdown rows. */
export function dropdownOptionStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "7px 12px",
    background: active ? "var(--bg-selected)" : "none",
    border: "none",
    color: active ? "var(--text)" : "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12,
    textAlign: "left",
    fontWeight: active ? 600 : 400,
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  };
}

/** Open state + outside reference for one dropdown trigger. */
export function useDropdown() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  return { open, setOpen, rootRef };
}

function CheckOrGap({ active }: { active: boolean }) {
  return active ? (
    <CheckIcon size={10} stroke="var(--accent)" style={{ flexShrink: 0 }} />
  ) : (
    <span style={{ width: 10, flexShrink: 0 }} />
  );
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_COLOR: Record<(typeof THINKING_LEVELS)[number], string> = {
  off: "#94a3b8",
  minimal: "#38bdf8",
  low: "#3b82f6",
  medium: "#8b5cf6",
  high: "#f97316",
  xhigh: "#ef4444",
  max: "#b91c1c",
};

/** One form field: label, control, then either the error or the hint. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <div style={fieldLabelStyle}>{label}</div>
      {children}
      {error && (
        <div data-field-error="true" style={fieldErrorStyle}>
          {error}
        </div>
      )}
      {!error && hint && <div style={fieldHintStyle}>{hint}</div>}
    </div>
  );
}

export function SchedulerModelSelect({
  form,
  update,
  meta,
  error,
}: {
  form: SchedulerTaskForm;
  update: (partial: Partial<SchedulerTaskForm>) => void;
  meta: SchedulerModelMeta | null;
  error?: string | null;
}) {
  const { t } = useI18n();
  const options = meta?.modelList ?? [];
  const modelIcons = meta?.modelIcons;
  const modelIconPreferences = meta?.modelIconPreferences;
  const isUnselected = !form.provider || !form.modelId;
  const current = options.find((o) => o.provider === form.provider && o.id === form.modelId);
  // Stable identity across parent re-renders — a fresh object literal here
  // would churn ModelPickerModal's memoized deps every time.
  const pickerModel = useMemo(
    () => (isUnselected ? null : { provider: form.provider, modelId: form.modelId }),
    [isUnselected, form.provider, form.modelId],
  );
  const [open, setOpen] = useState(false);
  const triggerIconId = resolveProviderIcon(current?.provider, current?.id, modelIcons, modelIconPreferences);

  return (
    <Field label={t("Model")} hint={t("Scheduler field required")} error={error}>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={pillTriggerStyle(open)}
        >
          <ProviderIcon id={triggerIconId ?? ""} size={12} fallback={<ProviderGearIcon size={11} />} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", minWidth: 0 }}>
            {isUnselected ? t("Select a model") : current?.name ?? `${form.provider}/${form.modelId}`}
          </span>
        </button>
        {/* Same `/model` picker modal as the chat input: grid layout + keyboard
            navigation. It may cover the panel — an accepted cost of reusing the
            shared picker instead of re-implementing the model list. */}
        <ModelPickerModal
          open={open}
          model={pickerModel}
          modelIcons={modelIcons}
          modelIconPreferences={modelIconPreferences}
          modelList={options}
          onModelChange={(provider, modelId) => {
            const partial: Partial<SchedulerTaskForm> = { provider, modelId };
            // Scheduled tasks must run with an explicit thinking level (no
            // "auto"), so when the new model does not support the current level
            // jump to the closest valid one instead of persisting a level the
            // run-time call would silently clamp.
            const nextAvailable = meta?.thinkingLevels[`${provider}:${modelId}`] ?? null;
            const currentLevel = form.thinkingLevel;
            if (currentLevel && (THINKING_LEVEL_ORDER as readonly string[]).includes(currentLevel)) {
              const nextLevel = pickClosestAvailableThinkingLevel(
                currentLevel as (typeof THINKING_LEVEL_ORDER)[number],
                nextAvailable,
              );
              if (nextLevel !== currentLevel) partial.thinkingLevel = nextLevel;
            }
            update(partial);
          }}
          onClose={() => setOpen(false)}
        />
      </div>
    </Field>
  );
}

export function SchedulerThinkingSelect({
  form,
  update,
  meta,
  error,
}: {
  form: SchedulerTaskForm;
  update: (partial: Partial<SchedulerTaskForm>) => void;
  meta: SchedulerModelMeta | null;
  error?: string | null;
}) {
  const { t } = useI18n();
  const key = form.provider && form.modelId ? `${form.provider}:${form.modelId}` : null;
  const available = key ? meta?.thinkingLevels[key] : undefined;
  const levelMap = key ? meta?.thinkingLevelMaps[key] : undefined;
  const current = form.thinkingLevel ? (form.thinkingLevel as (typeof THINKING_LEVELS)[number]) : null;
  const { open, setOpen, rootRef } = useDropdown();
  const currentMapped = current && levelMap ? levelMap[current] : undefined;
  const displayLabel = current
    ? currentMapped != null && currentMapped !== current
      ? currentMapped
      : current
    : t("Select a thinking level");

  return (
    <Field label={t("Thinking level")} hint={t("Scheduler field required")} error={error}>
      <div ref={rootRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            ...pillTriggerStyle(open),
            color: current ? THINKING_COLOR[current] : "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
          }}
        >
          <LightbulbIcon size={11} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", minWidth: 0 }}>
            {displayLabel}
          </span>
        </button>
        <AnimatedPopover open={open} style={dropdownPanelStyle} maxHeight={320}>
          {THINKING_LEVELS.filter((lvl) => (available ? available.includes(lvl) : true)).map((lvl) => {
            const active = current === lvl;
            const mappedVal = levelMap ? levelMap[lvl] : undefined;
            const label = mappedVal != null && mappedVal !== lvl ? mappedVal : lvl;
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => {
                  update({ thinkingLevel: lvl });
                  setOpen(false);
                }}
                style={dropdownOptionStyle(active)}
              >
                <CheckOrGap active={active} />
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: THINKING_COLOR[lvl], flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{label}</span>
                {mappedVal != null && mappedVal !== lvl && (
                  <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>({lvl})</span>
                )}
              </button>
            );
          })}
        </AnimatedPopover>
      </div>
    </Field>
  );
}

export function SchedulerToolsSelect({
  form,
  update,
  availableTools,
  toolsLoading,
  toolsError,
  customExpanded,
  onToggleCustomExpanded,
  onRetry,
}: {
  form: SchedulerTaskForm;
  update: (partial: Partial<SchedulerTaskForm>) => void;
  availableTools: ToolInfo[];
  toolsLoading: boolean;
  toolsError: string | null;
  customExpanded: boolean;
  onToggleCustomExpanded: () => void;
  onRetry: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { open, setOpen, rootRef } = useDropdown();
  const selection = form.toolSelection;
  // Patterns (e.g. "pi_work_*") expand against the catalog for display; the raw
  // selection (patterns included) is what gets stored so the server re-expands
  // it when the task's session starts.
  const toolNames = availableTools.map((tool) => tool.name);
  const selectedCount =
    selection === "all" ? availableTools.length : expandToolPatterns(Array.isArray(selection) ? selection : [], toolNames).length;
  const triggerLabel =
    selection === "all"
      ? t("All tools")
      : selection.length === 0
        ? t("No tools")
        : t("Custom selection ({count}/{total})", { count: selectedCount, total: availableTools.length });

  return (
    <Field label={t("Tool set")} hint={t("all: all tools, none: chat only, custom: comma-separated tool names")}>
      <div ref={rootRef} style={{ position: "relative" }}>
        <button type="button" onClick={() => setOpen((v) => !v)} style={pillTriggerStyle(open)}>
          <ToolIcon size={11} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", minWidth: 0 }}>
            {triggerLabel}
          </span>
        </button>
        <ToolsPickerModal
          open={open}
          toolSelection={selection}
          availableTools={availableTools}
          toolsLoading={toolsLoading}
          toolsError={toolsError}
          customExpanded={customExpanded}
          onToggleTool={(next) => update({ toolSelection: next })}
          onToggleCustomExpanded={onToggleCustomExpanded}
          onRetryEnsureTools={onRetry}
          onClose={() => setOpen(false)}
        />
      </div>
    </Field>
  );
}
