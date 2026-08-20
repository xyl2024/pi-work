"use client";

import React, { useState, useRef, useEffect, useMemo, type Ref } from "react";
import { AnimatedPopover } from "../ui/AnimatedPopover";
import { ProviderIcon, ProviderGearIcon, resolveProviderIcon } from "../ui/ProviderIcon";

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

/**
 * Model selector button + upward-anchored popover for the chat input.
 * Owns its open/close state, anchors the popover to the button's
 * bounding rect on every open, and handles outside-click dismissal.
 * Renders nothing when no model options are available or `onModelChange`
 * is absent (matches the previous gating in ChatInput).
 */
export function ModelPicker({
  model,
  modelNames,
  modelIcons,
  modelList,
  onModelChange,
  disabled,
}: {
  model: { provider: string; modelId: string } | null | undefined;
  modelNames?: Record<string, string>;
  /** Custom-model icon map ("<provider>:<modelId>" → provider id), from /api/models. */
  modelIcons?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  onModelChange: (provider: string, modelId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions = useMemo<ModelOption[]>(() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name }));
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    }));
  }, [modelList, modelNames, model?.provider]);

  // Group options by provider, preserving insertion order
  const modelsByProvider = useMemo<{ provider: string; options: ModelOption[] }[]>(() => {
    const out: { provider: string; options: ModelOption[] }[] = [];
    for (const opt of modelOptions) {
      const group = out.find((g) => g.provider === opt.provider);
      if (group) group.options.push(opt);
      else out.push({ provider: opt.provider, options: [opt] });
    }
    return out;
  }, [modelOptions]);

  const currentName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : modelOptions.length > 0 ? modelOptions[0].name : null;

  // Outside-click dismissal — only attach while the popover is open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (modelOptions.length === 0 || !currentName || !onModelChange) return null;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setRect({ top: r.top, left: r.left, width: r.width });
          setOpen((v) => !v);
        }}
        disabled={disabled}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "8px 12px",
          height: 32,
          maxWidth: 220, overflow: "hidden",
          background: open ? "var(--bg-hover)" : "none",
          border: "none",
          borderRadius: 9,
          color: "var(--text-muted)",
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: 12,
          opacity: disabled ? 0.5 : 1,
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => {
          if (disabled) return;
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = open ? "var(--bg-hover)" : "none";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <ProviderIcon
          id={resolveProviderIcon(model?.provider, model?.modelId, modelIcons) ?? ""}
          size={12}
          fallback={<ProviderGearIcon size={11} />}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{currentName}</span>
      </button>
      <ModelDropdownPanel
        rect={rect}
        open={open}
        groups={modelsByProvider}
        activeModel={model}
        modelIcons={modelIcons}
        panelRef={panelRef}
        onSelect={(provider, modelId, isActive) => {
          setOpen(false);
          if (!isActive) onModelChange(provider, modelId);
        }}
      />
    </div>
  );
}

/** Model-list popover for the chat input: an upward-expanding list anchored
 *  to the model button, animated via AnimatedPopover and clamped to the
 *  space above the input. Stays mounted (measured while invisible) so both
 *  open and close animate; long lists become scrollable once the height
 *  transition settles. */
function ModelDropdownPanel({
  rect,
  open,
  groups,
  activeModel,
  modelIcons,
  panelRef,
  onSelect,
}: {
  rect: { top: number; left: number; width: number } | null;
  open: boolean;
  groups: { provider: string; options: ModelOption[] }[];
  activeModel: { provider: string; modelId: string } | null | undefined;
  modelIcons?: Record<string, string>;
  panelRef?: Ref<HTMLDivElement>;
  onSelect: (provider: string, modelId: string, isActive: boolean) => void;
}) {
  // Before the first click `rect` is null: park the invisible panel
  // off-screen (it is opacity 0 / height 0 / no pointer events when closed).
  const viewportHeight = typeof window === "undefined" ? 0 : (window.visualViewport?.height ?? window.innerHeight);
  const maxH = Math.max(120, Math.min((rect?.top ?? viewportHeight) - 8, viewportHeight * 0.6));

  return (
    <AnimatedPopover
      open={open}
      maxHeight={maxH}
      panelRef={panelRef}
      style={{
        position: "fixed",
        ...(rect
          ? { bottom: viewportHeight - rect.top + 6, left: rect.left }
          : { top: -9999, left: 0 }),
        zIndex: 500,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
        width: "max-content",
        minWidth: rect?.width ?? 0,
      }}
    >
      {groups.map((group, gi) => (
        <div key={group.provider}>
          {(groups.length > 1) && (
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 12px 4px",
              fontSize: 10, fontWeight: 600, color: "var(--text-dim)",
              textTransform: "uppercase", letterSpacing: "0.07em",
              borderTop: gi > 0 ? "1px solid var(--border)" : "none",
            }}>
              <ProviderIcon id={resolveProviderIcon(group.provider, undefined, modelIcons) ?? ""} size={10} fallback={<ProviderGearIcon size={9} />} />
              <span>{group.provider}</span>
            </div>
          )}
          {group.options.map((opt) => {
            const isActive = opt.modelId === activeModel?.modelId && opt.provider === activeModel?.provider;
            return (
              <button
                key={`${opt.provider}:${opt.modelId}`}
                onClick={() => onSelect(opt.provider, opt.modelId, isActive)}
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
                <ProviderIcon id={resolveProviderIcon(opt.provider, opt.modelId, modelIcons) ?? ""} size={12} fallback={<ProviderGearIcon size={11} />} />
                {opt.name}
              </button>
            );
          })}
        </div>
      ))}
    </AnimatedPopover>
  );
}
