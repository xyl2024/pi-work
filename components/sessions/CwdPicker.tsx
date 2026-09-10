"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useCwdList, initCwdList } from "@/hooks/cwdListStore";
import { initCwdIcons } from "@/hooks/cwdIconStore";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { Tooltip } from "../ui/Tooltip";
import { CwdProjectIcon } from "../files/CwdProjectIcon";
import { CwdFolderDialog } from "./CwdFolderDialog";
import { useCwdAlias, useCwdAliases, initCwdAliases } from "@/hooks/cwdAliasStore";

interface CwdPickerProps {
  cwd: string | null;
  onCwdChange: (cwd: string) => void;
  disabled?: boolean;
  maxWidth?: number;
  fill?: boolean;
  dropdownDirection?: "up" | "down";
}

function basenameOf(cwd: string): string {
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  const parts = cwd.split(sep).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

export function CwdPicker({ cwd, onCwdChange, disabled = false, maxWidth = 160, fill = false }: CwdPickerProps) {
  const { t } = useI18n();
  const { cwds } = useCwdList();
  const { map: aliasMap } = useCwdAliases();
  const cwdAlias = useCwdAlias(cwd);
  const [open, setOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);

  useEffect(() => {
    initCwdList();
    initCwdIcons();
    initCwdAliases();
  }, []);

  const handlePick = useCallback((next: string) => {
    onCwdChange(next);
    setFolderOpen(false);
    setOpen(false);
  }, [onCwdChange]);

  const handleDefault = useCallback(async () => {
    try {
      const response = await fetch("/api/default-cwd", { method: "POST" });
      const data = await response.json() as { cwd?: string };
      if (data.cwd) handlePick(data.cwd);
    } catch { /* keep the modal open so the user can retry */ }
  }, [handlePick]);

  // Show the user-set alias when present; fall back to the basename.
  const buttonLabel = cwd ? (cwdAlias ?? basenameOf(cwd)) : t("Select project...");
  // Hovering an aliased cwd reveals its absolute path; unaliased cwds keep
  // the generic action hint.
  const buttonTitle = cwd ? (cwdAlias ? cwd : t("Change project")) : t("Pick a project");

  return (
    <>
      <Tooltip content={buttonTitle}>
        <button
          type="button"
          onClick={() => { if (!disabled) setOpen(true); }}
          disabled={disabled}
          aria-label={buttonTitle}
          aria-haspopup="dialog"
          aria-expanded={open}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", height: 32, width: fill ? "100%" : undefined, maxWidth: fill ? "none" : maxWidth, boxSizing: "border-box", overflow: "hidden", background: open ? "var(--bg-hover)" : "none", border: "none", borderRadius: 9, color: cwd ? "var(--text)" : "var(--text-muted)", cursor: disabled ? "not-allowed" : "pointer", fontSize: 12, opacity: disabled ? 0.5 : 1, transition: "background 0.12s, color 0.12s" }}
          onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
          onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.background = open ? "var(--bg-hover)" : "none"; e.currentTarget.style.color = cwd ? "var(--text)" : "var(--text-muted)"; } }}
        >
          <span style={{ display: "flex", flexShrink: 0, color: "var(--accent)" }}><CwdProjectIcon cwd={cwd} size={14} /></span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, fontFamily: "var(--font-mono)" }}>{buttonLabel}</span>
        </button>
      </Tooltip>
      {open && <CwdPickerModal
        open
        cwd={cwd}
        cwds={cwds ?? []}
        aliasMap={aliasMap}
        onCwdChange={handlePick}
        onDefaultCwd={handleDefault}
        onSelectFolder={() => { setOpen(false); setFolderOpen(true); }}
        onClose={() => setOpen(false)}
      />}
      {folderOpen && <CwdFolderDialog open startPath={cwd} onClose={() => setFolderOpen(false)} onSelect={handlePick} />}
    </>
  );
}

function CwdPickerModal({ open, cwd, cwds, aliasMap, onCwdChange, onDefaultCwd, onSelectFolder, onClose }: {
  open: boolean;
  cwd: string | null;
  cwds: string[];
  aliasMap: Record<string, string> | null;
  onCwdChange: (cwd: string) => void;
  onDefaultCwd: () => Promise<void>;
  onSelectFolder: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { requestClose, backdropStyle, panelStyle, isVisible, phase } = useModalAnimation({ isOpen: open, onClose, backdropAlpha: 0.35 });
  useBodyScrollLock(isVisible);
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Number of cards per grid row at the active index — derived from the
  // DOM (cards sharing the same offsetTop) so it stays correct across
  // resizes, filtering and group boundaries (same trick as
  // ModelPickerModal).
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
    // Match against the alias (when set) in addition to basename + path.
    return q
      ? cwds.filter((item) => `${aliasMap?.[item] ?? ""} ${basenameOf(item)} ${item}`.toLowerCase().includes(q))
      : cwds;
  }, [cwds, aliasMap, query]);

  useEffect(() => { setPortalEl(document.body); }, []);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const currentIndex = filtered.findIndex((item) => item === cwd);
    setActiveIndex(currentIndex >= 0 ? currentIndex : 0);
  }, [open, cwd, filtered]);
  useEffect(() => { setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1))); }, [filtered.length]);
  useEffect(() => { rowRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);
  useEffect(() => {
    if (!isVisible) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); requestClose(); return; }
      if (phase !== "open" || filtered.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        setActiveIndex((index) => {
          // ← / → move one card; ↑ / ↓ move a full grid row (column count
          // read from the rendered grid so it adapts to the panel width).
          if (event.key === "ArrowLeft") return (index - 1 + filtered.length) % filtered.length;
          if (event.key === "ArrowRight") return (index + 1) % filtered.length;
          const step = (event.key === "ArrowDown" ? 1 : -1) * columnCount(index);
          return (index + step + filtered.length) % filtered.length;
        });
      } else if (event.key === "Enter") {
        const item = filtered[activeIndex];
        if (item) { event.preventDefault(); onCwdChange(item); requestClose(); }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isVisible, phase, filtered, activeIndex, onCwdChange, requestClose, columnCount]);

  if (!isVisible || !portalEl) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t("Change project")} style={backdropStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div style={{ ...panelStyle, width: "min(680px, calc(100vw - 32px))", maxHeight: "min(560px, calc(100vh - 64px))", display: "flex", flexDirection: "column", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,.22)", overflow: "hidden" }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px" }}><span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t("Change project")}</span><button type="button" onClick={requestClose} aria-label={t("Close")} style={{ background: "none", border: 0, color: "var(--text-dim)", cursor: "pointer", fontSize: 18 }}>×</button></div>
        <div style={{ padding: "0 14px 10px" }}><div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" }}><span style={{ color: "var(--text-dim)" }}>⌕</span><input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search projects...")} spellCheck={false} style={{ flex: 1, minWidth: 0, background: "none", border: 0, outline: 0, color: "var(--text)", fontSize: 13, padding: "8px 2px" }} /></div></div>
        <div style={{ flex: 1, minHeight: 80, overflowY: "auto", padding: "0 8px 8px" }} data-hide-v-scrollbar>
          {filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>{cwds.length ? t("No matches") : t("No projects yet")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 4, padding: "2px 4px 6px" }}>
              {filtered.map((item, index) => {
                const isCurrent = item === cwd;
                return (
                  <button key={item} ref={(el) => { rowRefs.current[index] = el; }} type="button" onClick={() => { onCwdChange(item); requestClose(); }} onMouseEnter={() => setActiveIndex(index)} title={item} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px", textAlign: "left", background: index === activeIndex ? "var(--bg-selected)" : "none", border: `1px solid ${isCurrent ? "var(--accent)" : "transparent"}`, borderRadius: 7, color: "var(--text)", cursor: "pointer" }}>
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 16, flexShrink: 0, color: "var(--accent)" }}>
                      {isCurrent
                        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        : <CwdProjectIcon cwd={item} size={14} />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, color: index === activeIndex ? "var(--text)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{aliasMap?.[item] ?? basenameOf(item)}</span>
                      <span style={{ display: "block", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, padding: "8px 14px", borderTop: "1px solid var(--border)" }}><button type="button" onClick={() => void onDefaultCwd()} style={{ flex: 1, padding: "7px 8px", background: "none", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>{t("Use default directory")}</button><button type="button" onClick={onSelectFolder} style={{ flex: 1, padding: "7px 8px", background: "none", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>{t("Select folder...")}</button></div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 14px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-dim)" }}><span>{t("↑↓←→ select · Enter confirm · Esc close")}</span>{filtered.length > 0 && <span style={{ fontFamily: "var(--font-mono)" }}>{filtered.length} {t("projects")}</span>}</div>
      </div>
    </div>, portalEl,
  );
}
