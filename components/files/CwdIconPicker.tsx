"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { CWD_ICON_NAMES } from "@/lib/shared/lucide-names";
import { CWD_EMOJI_OPTIONS } from "./cwd-emoji-list";
import { CWD_ICON_MAP } from "./cwd-icon-map";
import { CwdIcon } from "./FileIcons";
import { encodeEmojiValue, emojiOf } from "@/lib/shared/cwd-icon";

type Tab = "icons" | "emoji";

/**
 * Modal icon picker for a cwd's custom icon. Two tabs: lucide icons and a
 * curated emoji set, each searchable, plus a "default folder" option to clear
 * the override. `current` is the storage value — a lucide name, an `emoji:…`
 * value, or null.
 */
export function CwdIconPicker({
  open,
  title,
  current,
  onSelect,
  onClose,
}: {
  open: boolean;
  title: string;
  current: string | null;
  onSelect: (icon: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("icons");

  useEffect(() => {
    setPortalEl(document.body);
  }, []);

  // On open: start on whichever tab owns the current value (emoji value →
  // emoji tab), clear the search box.
  useEffect(() => {
    if (open) {
      setQuery("");
      setTab(current ? (emojiOf(current) ? "emoji" : "icons") : "icons");
    }
  }, [open, current]);

  const q = query.trim().toLowerCase();

  const filteredIcons = useMemo(() => {
    if (!q) return CWD_ICON_NAMES;
    return CWD_ICON_NAMES.filter((n) => n.toLowerCase().includes(q));
  }, [q]);

  const filteredEmoji = useMemo(() => {
    // Dedupe by emoji character (labelled synonyms can repeat the same glyph).
    const seen = new Set<string>();
    const out: typeof CWD_EMOJI_OPTIONS = [];
    for (const o of CWD_EMOJI_OPTIONS) {
      if (!q || o.label.toLowerCase().includes(q)) {
        if (seen.has(o.emoji)) continue;
        seen.add(o.emoji);
        out.push(o);
      }
    }
    return out;
  }, [q]);

  if (!open || !portalEl) return null;

  const empty = tab === "icons" ? filteredIcons.length === 0 : filteredEmoji.length === 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          width: 420,
          maxWidth: "100%",
          maxHeight: "80vh",
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", flex: 1 }}>
            {title}
          </span>
          <button
            aria-label={t("Close")}
            onClick={onClose}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 24, height: 24, padding: 0,
              background: "transparent", border: "none",
              color: "var(--text-muted)", cursor: "pointer", borderRadius: 6,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="3" y1="3" x2="9" y2="9" />
              <line x1="9" y1="3" x2="3" y2="9" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, padding: "0 16px 10px" }}>
          {(
            [
              ["icons", t("Icons")],
              ["emoji", t("Emoji")],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: "5px 14px",
                background: tab === key ? "var(--bg-selected)" : "transparent",
                border: tab === key ? "1px solid color-mix(in srgb, var(--accent) 40%, transparent)" : "1px solid transparent",
                borderRadius: 7,
                color: tab === key ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: tab === key ? 600 : 400,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => { if (tab !== key) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
              onMouseLeave={(e) => { if (tab !== key) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; } }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ padding: "0 16px 10px" }}>
          <div style={{ position: "relative" }}>
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ position: "absolute", left: 9, top: 9, color: "var(--text-dim)", pointerEvents: "none" }}
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="20" y1="20" x2="16.5" y2="16.5" />
            </svg>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "icons" ? t("Search icons...") : t("Search emoji...")}
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "6px 10px 6px 26px",
                background: "var(--bg-input, var(--bg))",
                border: "1px solid var(--border)",
                borderRadius: 7,
                color: "var(--text)",
                fontSize: 12,
                outline: "none",
              }}
            />
          </div>
        </div>

        {/* Default option + grid */}
        <div data-scroll-inset style={{ overflowY: "auto", padding: "0 12px 14px" }}>
          {/* Clear / default folder */}
          <button
            onClick={() => onSelect(null)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              width: "100%", boxSizing: "border-box",
              padding: "8px 10px",
              background: current === null ? "var(--bg-selected)" : "transparent",
              border: "none", borderRadius: 7,
              color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 12,
            }}
          >
            <span style={{ display: "flex", color: "var(--accent)" }}>
              <CwdIcon size={16} />
            </span>
            <span>{t("Default folder icon")}</span>
          </button>

          {empty && (
            <div style={{ padding: "18px 10px", fontSize: 11, color: "var(--text-dim)", textAlign: "center" }}>
              {t("No icons match")}
            </div>
          )}

          {/* Grid */}
          {tab === "icons" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))", gap: 4, marginTop: 8 }}>
              {filteredIcons.map((name) => {
                const Icon = CWD_ICON_MAP[name];
                const selected = current === name;
                return (
                  <button
                    key={name}
                    aria-label={name}
                    title={name}
                    onClick={() => onSelect(name)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      height: 40, padding: 0,
                      background: selected ? "var(--bg-selected)" : "transparent",
                      border: selected ? "1px solid var(--accent)" : "1px solid transparent",
                      borderRadius: 7,
                      color: selected ? "var(--accent)" : "var(--text-muted)",
                      cursor: "pointer",
                      transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={(e) => { if (!selected) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
                    onMouseLeave={(e) => { if (!selected) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; } }}
                  >
                    <Icon size={18} strokeWidth={1.8} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))", gap: 4, marginTop: 8 }}>
              {filteredEmoji.map((o) => {
                const value = encodeEmojiValue(o.emoji);
                const selected = current === value;
                return (
                  <button
                    key={value}
                    aria-label={o.label}
                    title={o.label}
                    onClick={() => onSelect(value)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      height: 40, padding: 0,
                      background: selected ? "var(--bg-selected)" : "transparent",
                      border: selected ? "1px solid var(--accent)" : "1px solid transparent",
                      borderRadius: 7,
                      cursor: "pointer",
                      fontSize: 20,
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
                  >
                    {o.emoji}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    portalEl
  );
}