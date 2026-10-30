"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { ProviderIcon, ProviderGearIcon, resolveProviderIcon } from "../ui/ProviderIcon";

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

export function ModelPickerModal({
  open,
  model,
  modelNames,
  modelIcons,
  modelIconPreferences,
  modelList,
  disabled,
  onModelChange,
  onClose,
}: {
  open: boolean;
  model: { provider: string; modelId: string } | null | undefined;
  modelNames?: Record<string, string>;
  modelIcons?: Record<string, string>;
  modelIconPreferences?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  disabled?: boolean;
  onModelChange?: (provider: string, modelId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { requestClose, backdropStyle, panelStyle, isVisible, phase } = useModalAnimation({
    isOpen: open,
    onClose,
    backdropAlpha: 0.35,
  });
  useBodyScrollLock(isVisible);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const options = useMemo<ModelOption[]>(() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name }));
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    }));
  }, [modelList, modelNames, model?.provider]);

  const isActive = useCallback(
    (opt: ModelOption) => opt.modelId === model?.modelId && opt.provider === model?.provider,
    [model],
  );

  const columnCount = useCallback((index: number): number => {
    const el = rowRefs.current[index];
    const grid = el?.parentElement;
    if (!el || !grid) return 1;
    const top = el.offsetTop;
    let count = 0;
    for (const child of Array.from(grid.children)) {
      if (Math.abs((child as HTMLElement).offsetTop - top) < 2) count++;
    }
    return Math.max(1, count);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) =>
      opt.name.toLowerCase().includes(q) ||
      opt.modelId.toLowerCase().includes(q) ||
      opt.provider.toLowerCase().includes(q),
    );
  }, [options, query]);

  const groups = useMemo(() => {
    const out: { provider: string; options: ModelOption[] }[] = [];
    for (const opt of filtered) {
      const group = out.find((g) => g.provider === opt.provider);
      if (group) group.options.push(opt);
      else out.push({ provider: opt.provider, options: [opt] });
    }
    return out;
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const navKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      navKeyRef.current = null;
      return;
    }
    const key = `q:${query}`;
    if (navKeyRef.current === key) return;
    navKeyRef.current = key;
    const idx = filtered.findIndex(isActive);
    setActiveIndex(idx >= 0 ? idx : 0);
  }, [open, query, filtered, isActive]);

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const selectOption = useCallback(
    (opt: ModelOption) => {
      if (phase !== "open" || disabled) return;
      if (onModelChange && !isActive(opt)) onModelChange(opt.provider, opt.modelId);
      requestClose();
    },
    [phase, disabled, isActive, onModelChange, requestClose],
  );

  useEffect(() => {
    if (!isVisible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
        return;
      }
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setActiveIndex((i) => {
          if (e.key === "ArrowLeft") return (i - 1 + filtered.length) % filtered.length;
          if (e.key === "ArrowRight") return (i + 1) % filtered.length;
          const step = (e.key === "ArrowDown" ? 1 : -1) * columnCount(i);
          return (i + step + filtered.length) % filtered.length;
        });
        return;
      }
      if (e.key === "Enter") {
        const target = e.target as HTMLElement | null;
        if (target && target.tagName === "BUTTON") return;
        const opt = filtered[activeIndex];
        if (opt) {
          e.preventDefault();
          selectOption(opt);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isVisible, filtered, activeIndex, selectOption, requestClose, columnCount]);

  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalEl(document.body);
  }, []);

  if (!isVisible || !portalEl) return null;

  const current = model ? options.find(isActive) ?? null : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Switch model")}
      style={backdropStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        style={{
          ...panelStyle,
          width: "min(680px, calc(100vw - 32px))",
          maxHeight: "min(560px, calc(100vh - 64px))",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px", flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", flex: 1 }}>
            {t("Switch model")}
          </span>
          <button
            onClick={requestClose}
            aria-label={t("Close")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 24, height: 24, padding: 0,
              background: "none", border: "none", borderRadius: 6,
              color: "var(--text-dim)", cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="20" y2="20" />
              <line x1="20" y1="4" x2="4" y2="20" />
            </svg>
          </button>
        </div>

        <div style={{ padding: "0 14px 10px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search models...")}
              spellCheck={false}
              style={{
                flex: 1,
                background: "none", border: "none", outline: "none",
                color: "var(--text)", fontSize: 13,
                padding: "8px 2px", minWidth: 0,
              }}
            />
            {query && (
              <button
                onClick={() => { setQuery(""); inputRef.current?.focus(); }}
                aria-label={t("Clear")}
                style={{ background: "none", border: "none", padding: 2, color: "var(--text-dim)", cursor: "pointer", display: "flex" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="4" x2="20" y2="20" />
                  <line x1="20" y1="4" x2="4" y2="20" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 8px", minHeight: 80 }} data-hide-v-scrollbar>
          {filtered.length === 0 ? (
            <div style={{ padding: "24px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
              {t("No matches")}
            </div>
          ) : (
            <>
              {current && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 8px", fontSize: 11, color: "var(--text-dim)" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t("Current model")}: {current.name}
                  </span>
                </div>
              )}
              {groups.map((group, gi) => (
                <div key={group.provider}>
                  {groups.length > 1 && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "6px 10px 3px",
                      fontSize: 10, fontWeight: 600, color: "var(--text-dim)",
                      textTransform: "uppercase", letterSpacing: "0.07em",
                      borderTop: gi > 0 ? "1px solid var(--border)" : "none",
                    }}>
                      <ProviderIcon id={resolveProviderIcon(group.provider, undefined, modelIcons, modelIconPreferences) ?? ""} size={10} fallback={<ProviderGearIcon size={9} />} />
                      <span>{group.provider}</span>
                    </div>
                  )}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                    gap: 4,
                    padding: "2px 4px 6px",
                  }}>
                  {group.options.map((opt) => {
                    const idx = filtered.indexOf(opt);
                    const active = idx === activeIndex;
                    const currentRow = isActive(opt);
                    return (
                      <button
                        key={`${opt.provider}:${opt.modelId}`}
                        ref={(el) => { rowRefs.current[idx] = el; }}
                        onClick={() => selectOption(opt)}
                        disabled={disabled}
                        onMouseEnter={() => { if (!disabled) setActiveIndex(idx); }}
                        style={{
                          width: "100%",
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "7px 10px", textAlign: "left",
                          background: active ? "var(--bg-selected)" : "none",
                          border: `1px solid ${currentRow ? "var(--accent)" : "transparent"}`,
                          borderRadius: 7,
                          cursor: disabled ? "not-allowed" : "pointer",
                          opacity: disabled ? 0.55 : 1,
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 18, flexShrink: 0 }}>
                          {currentRow && (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
                        <ProviderIcon
                          id={resolveProviderIcon(opt.provider, opt.modelId, modelIcons, modelIconPreferences) ?? ""}
                          size={13}
                          fallback={<ProviderGearIcon size={12} />}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 13, color: active ? "var(--text)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {opt.name}
                          </span>
                          <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {opt.modelId}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 14px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>
          {disabled ? (
            <span>{t("Model locked while agent is running")}</span>
          ) : (
            <span>{t("↑↓←→ select · Enter confirm · Esc close")}</span>
          )}
          {filtered.length > 0 && (
            <span style={{ fontFamily: "var(--font-mono)" }}>{filtered.length} {t("models")}</span>
          )}
        </div>
      </div>
    </div>,
    portalEl,
  );
}