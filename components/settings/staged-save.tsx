"use client";

import { useI18n } from "@/hooks/useI18n";
import { PrimaryButton } from "./controls";

/**
 * The one staged-save button. Every explicit-save setting (append system
 * prompt, network proxy, profile, Tavily key) uses the same three states so
 * the user does not have to learn a different vocabulary per section:
 *
 *   - can save  → accent, clickable
 *   - saving    → muted, disabled
 *   - saved     → success colour + check, briefly disabled
 *
 * The button skin itself comes from the shared `PrimaryButton`; this only
 * varies the three state colours.
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
    <PrimaryButton
      onClick={onClick}
      disabled={disabled}
      style={{
        background: saved ? "var(--success)" : saving ? "var(--bg)" : "var(--accent)",
        color: saving ? "var(--text-muted)" : "#fff",
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
    </PrimaryButton>
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