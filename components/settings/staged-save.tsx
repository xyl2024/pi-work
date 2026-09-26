"use client";

import { useI18n } from "@/hooks/useI18n";

/**
 * The one staged-save button. Every explicit-save setting (append system
 * prompt, network proxy, profile) uses the same three states so the user does
 * not have to learn a different vocabulary per section:
 *
 *   - can save  → accent, clickable
 *   - saving    → muted, disabled
 *   - saved     → success colour + check, briefly disabled
 */
export function SaveButton({
  canSave,
  saving,
  saved,
  onClick,
}: {
  canSave: boolean;
  saving: boolean;
  saved: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const disabled = !canSave || saving || saved;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "4px 14px",
        height: 28,
        background: saved ? "var(--success)" : saving ? "var(--bg)" : "var(--accent)",
        border: "none",
        borderRadius: 6,
        color: saving ? "var(--text-muted)" : "#fff",
        cursor: disabled ? "default" : "pointer",
        fontSize: 12,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        transition: "background-color 0.2s ease, color 0.2s ease",
        opacity: !canSave && !saving && !saved ? 0.5 : 1,
      }}
    >
      {saved && (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      <span>{saved ? t("Saved") : saving ? t("Saving...") : t("Save")}</span>
    </button>
  );
}

/** The shared "this staged value has not been written yet" hint. */
export function UnsavedHint({ show }: { show: boolean }) {
  const { t } = useI18n();
  if (!show) return null;
  return (
    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
      · {t("Unsaved changes")}
    </span>
  );
}