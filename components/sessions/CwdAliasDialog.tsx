"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";

/**
 * Small modal for editing a cwd's display alias. Empty input (or the
 * "clear" button) removes the alias; Saving persists via the caller,
 * which decides whether the dialog closes (only on success).
 */
export function CwdAliasDialog({
  open,
  cwd,
  current,
  onSave,
  onClose,
}: {
  open: boolean;
  cwd: string;
  /** Current alias (or null when unset). Re-seeds the input on open. */
  current: string | null;
  onSave: (alias: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPortalEl(document.body);
  }, []);

  // Re-seed the input each time the dialog opens.
  useEffect(() => {
    if (open) {
      setValue(current ?? "");
      setSaving(false);
    }
  }, [open, current]);

  if (!open || !portalEl) return null;

  const trimmed = value.trim();

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await onSave(trimmed.length > 0 ? trimmed : null);
    if (ok) {
      onClose();
    } else {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Set project alias")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !saving) {
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
          width: 400,
          maxWidth: "100%",
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", flex: 1 }}>
            {t("Set project alias")}
          </span>
          <button
            aria-label={t("Close")}
            onClick={onClose}
            disabled={saving}
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

        {/* Body */}
        <div style={{ padding: "0 16px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {cwd}
          </span>
          <input
            autoFocus
            value={value}
            maxLength={100}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
            placeholder={t("Leave empty to clear the alias")}
            spellCheck={false}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "7px 10px",
              background: "var(--bg-input, var(--bg))",
              border: "1px solid var(--border)",
              borderRadius: 7,
              color: "var(--text)",
              fontSize: 12,
              outline: "none",
            }}
          />
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 8, padding: "10px 16px 14px" }}>
          <button
            onClick={() => { setValue(""); void submit(); }}
            disabled={saving || trimmed.length === 0}
            style={{
              flex: 1, padding: "7px 8px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 7,
              color: trimmed.length === 0 ? "var(--text-dim)" : "var(--text-muted)",
              cursor: saving || trimmed.length === 0 ? "default" : "pointer",
              fontSize: 11,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {t("Clear alias")}
          </button>
          <button
            onClick={() => void submit()}
            disabled={saving}
            style={{
              flex: 1, padding: "7px 8px",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: 7,
              color: "#fff",
              cursor: saving ? "default" : "pointer",
              fontSize: 11,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {t("Save")}
          </button>
        </div>
      </div>
    </div>,
    portalEl
  );
}
