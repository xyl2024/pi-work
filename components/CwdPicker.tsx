"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useCwdList, initCwdList } from "@/hooks/cwdListStore";
import { Tooltip } from "./Tooltip";
import { AnimatedPopover } from "./AnimatedPopover";
import { CwdIcon } from "./FileIcons";

/**
 * Reusable cwd picker — the previously inline picker that lived in the
 * sidebar header, now reused in ChatInput for the new-session flow.
 *
 * UI matches the model picker in ChatInput's bottom toolbar (folder icon +
 * basename pill), while the dropdown mirrors the original sidebar menu:
 * Recent list, plus Use default / Custom path entries at the bottom.
 * Dropdown opens upward by default since the parent is anchored at the
 * bottom of the chat area — pass `dropdownDirection` to flip it if needed.
 */
interface CwdPickerProps {
  /** Current cwd; null means "no project selected yet". */
  cwd: string | null;
  /** Fires when the user picks a different cwd (or creates one). */
  onCwdChange: (cwd: string) => void;
  /** Grays the trigger and ignores click. */
  disabled?: boolean;
  /** Max width of the trigger pill in pixels. */
  maxWidth?: number;
  /** Open upward (default) or downward. */
  dropdownDirection?: "up" | "down";
}

function basenameOf(cwd: string): string {
  // Pick the separator that actually appears in the path. Windows uses
  // backslashes; POSIX uses slashes. If both are present (unusual but
  // legal on Windows after POSIX tools), prefer "/" so mixed paths render
  // sensibly. filter(Boolean) drops the empty leading segment produced by
  // absolute paths.
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  const parts = cwd.split(sep).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

export function CwdPicker({
  cwd,
  onCwdChange,
  disabled = false,
  maxWidth = 160,
  dropdownDirection = "up",
}: CwdPickerProps) {
  const { t } = useI18n();
  const { cwds } = useCwdList();

  const [open, setOpen] = useState(false);
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState("");
  const customPathInputRef = useRef<HTMLInputElement>(null);
  // Single click target — both the trigger and dropdown live under it, so
  // outside-click detection just walks up the DOM for this data attribute.
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Kick off the one-time app-wide fetch if it hasn't started yet (idempotent;
  // AppShell also calls it on mount).
  useEffect(() => {
    initCwdList();
  }, []);

  // Close on outside mousedown.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) {
        setOpen(false);
        setCustomPathOpen(false);
        setCustomPathValue("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handlePick = useCallback((picked: string) => {
    onCwdChange(picked);
    setOpen(false);
    setCustomPathOpen(false);
    setCustomPathValue("");
  }, [onCwdChange]);

  const handleCommitCustomPath = useCallback(() => {
    const path = customPathValue.trim();
    if (path) handlePick(path);
  }, [customPathValue, handlePick]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string };
      if (data.cwd) handlePick(data.cwd);
    } catch { /* ignore */ }
  }, [handlePick]);

  const recentCwds = cwds ?? [];

  const up = dropdownDirection === "up";
  const buttonLabel = cwd ? basenameOf(cwd) : t("Select project...");
  const buttonTitle = cwd ? t("Change project") : t("Pick a project");

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <Tooltip content={buttonTitle}>
        <button
          onClick={() => { if (!disabled) setOpen((v) => !v); }}
          disabled={disabled}
          aria-label={buttonTitle}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 12px",
            height: 32,
            maxWidth, overflow: "hidden",
            background: open ? "var(--bg-hover)" : "none",
            border: "none",
            borderRadius: 9,
            color: cwd ? "var(--text)" : "var(--text-muted)",
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
            if (disabled) return;
            e.currentTarget.style.background = open ? "var(--bg-hover)" : "none";
            e.currentTarget.style.color = cwd ? "var(--text)" : "var(--text-muted)";
          }}
        >
          {/* Cwd / project icon — filled, theme-tinted via currentColor.
              Pinned to var(--accent) so it pops in the trigger pill; the
              button label keeps the inherited text/text-muted ramp. */}
          <span style={{ display: "flex", flexShrink: 0, color: "var(--accent)" }}>
            <CwdIcon size={14} />
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, fontFamily: "var(--font-mono)" }}>
            {buttonLabel}
          </span>
        </button>
      </Tooltip>

      <AnimatedPopover
        open={open}
        role="listbox"
        style={{
          position: "absolute",
          ...(up ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }),
          left: 0,
          zIndex: 100,
          minWidth: 240,
          maxWidth: 300,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
          fontSize: 12,
        }}
      >
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {/* Recent list */}
            {recentCwds.map((rcwd) => (
              <Tooltip key={`recent-${rcwd}`} content={rcwd}>
                <button
                  onClick={() => handlePick(rcwd)}
                  style={{
                    display: "flex", alignItems: "center", gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: rcwd === cwd ? "var(--bg-selected)" : "none",
                    border: "none", borderBottom: "1px solid var(--border)",
                    color: rcwd === cwd ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {basenameOf(rcwd)}
                  </span>
                </button>
              </Tooltip>
            ))}

            {/* Empty state inside the dropdown */}
            {cwds !== null && recentCwds.length === 0 && (
              <div style={{ padding: "10px", fontSize: 11, color: "var(--text-dim)" }}>
                {t("No projects yet")}
              </div>
            )}
          </div>

          {/* Footer entries */}
          {!customPathOpen && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); void handleDefaultCwd(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  width: "100%", padding: "8px 10px",
                  background: "none", border: "none",
                  borderTop: (cwds?.length ?? 0) > 0 ? "1px solid var(--border)" : "none",
                  color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
                </svg>
                <span>{t("Use default directory")}</span>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCustomPathOpen(true);
                  setTimeout(() => customPathInputRef.current?.focus(), 0);
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  width: "100%", padding: "8px 10px",
                  background: "none", border: "none",
                  color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <line x1="5" y1="1" x2="5" y2="9" />
                  <line x1="1" y1="5" x2="9" y2="5" />
                </svg>
                <span>{t("Custom path...")}</span>
              </button>
            </>
          )}

          {customPathOpen && (
            <div style={{ padding: "6px 8px", borderTop: "1px solid var(--border)" }}>
              <input
                ref={customPathInputRef}
                value={customPathValue}
                onChange={(e) => setCustomPathValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCommitCustomPath();
                  if (e.key === "Escape") {
                    setCustomPathOpen(false);
                    setCustomPathValue("");
                  }
                }}
                placeholder="/path/to/project"
                style={{
                  width: "100%", fontSize: 11, fontFamily: "var(--font-mono)",
                  padding: "5px 8px",
                  border: "1px solid var(--accent)", borderRadius: 5,
                  outline: "none", background: "var(--bg)", color: "var(--text)",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                <button
                  onClick={handleCommitCustomPath}
                  style={{
                    flex: 1, padding: "4px 0",
                    background: "var(--accent)", border: "none", borderRadius: 5,
                    color: "#fff", fontSize: 11, fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {t("Open")}
                </button>
                <button
                  onClick={() => { setCustomPathOpen(false); setCustomPathValue(""); }}
                  style={{
                    flex: 1, padding: "4px 0",
                    background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5,
                    color: "var(--text-muted)", fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  {t("Cancel")}
                </button>
              </div>
            </div>
          )}
      </AnimatedPopover>
    </div>
  );
}
