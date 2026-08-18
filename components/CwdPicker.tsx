"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useCwdList, initCwdList } from "@/hooks/cwdListStore";
import { Tooltip } from "./Tooltip";
import { AnimatedPopover } from "./AnimatedPopover";
import { CwdIcon } from "./FileIcons";
import { CwdFolderDialog } from "./CwdFolderDialog";

/**
 * Reusable cwd picker — the previously inline picker that lived in the
 * sidebar header, now reused in ChatInput for the new-session flow.
 *
 * UI matches the model picker in ChatInput's bottom toolbar (folder icon +
 * basename pill), while the dropdown mirrors the original sidebar menu:
 * Recent list, plus Use default / Select folder entries at the bottom.
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
  /** Make the trigger pill fill its container width (form usage). */
  fill?: boolean;
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
  fill = false,
}: CwdPickerProps) {
  const { t } = useI18n();
  const { cwds } = useCwdList();

  const [open, setOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
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
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handlePick = useCallback((picked: string) => {
    onCwdChange(picked);
    setOpen(false);
    setFolderDialogOpen(false);
  }, [onCwdChange]);

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
            width: fill ? "100%" : undefined,
            maxWidth: fill ? "none" : maxWidth,
            boxSizing: "border-box",
            overflow: "hidden",
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
          <div data-scroll-inset style={{ maxHeight: 320, overflowY: "auto" }}>
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
                  <span style={{ display: "flex", flexShrink: 0, color: "var(--accent)" }}>
                    <CwdIcon size={14} />
                  </span>
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
                onClick={(e) => { e.stopPropagation(); setFolderDialogOpen(true); }}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  width: "100%", padding: "8px 10px",
                  background: "none", border: "none",
                  color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
                </svg>
                <span>{t("Select folder...")}</span>
              </button>
          </>
      </AnimatedPopover>

      {folderDialogOpen && (
        <CwdFolderDialog
          open
          startPath={cwd ?? null}
          onClose={() => setFolderDialogOpen(false)}
          onSelect={(dir) => { setFolderDialogOpen(false); handlePick(dir); }}
        />
      )}
    </div>
  );
}
