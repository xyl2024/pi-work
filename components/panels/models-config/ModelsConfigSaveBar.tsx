"use client";

import { useI18n } from "@/hooks/useI18n";
import {
  saveModelsConfig,
  selectModelsConfigDirty,
  selectModelsConfigProblem,
  useModelsConfigStore,
} from "@/lib/client/models-config-store";
import { modelsConfigProblemText } from "@/lib/client/models-config-problem-text";

/**
 * The panel's fixed save footer. It never scrolls away, and it is where both
 * the save feedback (saving / saved) and the failure text live — the panel
 * writes the whole draft to `models.json` in one PUT.
 */
export function ModelsConfigSaveBar() {
  const { t } = useI18n();
  const state = useModelsConfigStore();
  const { saving, savedOk, saveError } = state;
  const dirty = selectModelsConfigDirty(state);
  const problem = selectModelsConfigProblem(state);
  // An unparsable raw edit is not part of the draft; the save button stays down
  // and the bar says what is wrong so the text can be repaired in place.
  const blockedText = modelsConfigProblemText(problem, t);
  const disabled = saving || savedOk || !dirty || problem !== null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: "1px solid var(--border)", background: "var(--bg)", flexShrink: 0 }}>
      <span
        title={saveError ?? blockedText ?? undefined}
        style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: saveError || blockedText ? "var(--error)" : "var(--text-dim)", fontSize: 11 }}
      >
        {saveError ?? blockedText ?? ""}
      </span>
      <button
        type="button"
        onClick={() => { void saveModelsConfig(); }}
        disabled={disabled}
        style={{
          position: "relative",
          padding: "5px 16px",
          minWidth: 92,
          background: savedOk ? "var(--success)" : disabled ? "var(--bg)" : "var(--accent)",
          border: disabled && !savedOk ? "1px solid var(--border)" : "none",
          borderRadius: 6,
          color: savedOk ? "#fff" : disabled ? "var(--text-dim)" : "#fff",
          cursor: disabled ? "default" : "pointer",
          fontSize: 13,
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          flexShrink: 0,
          transition: "background-color 0.2s ease, color 0.2s ease",
          animation: savedOk ? "saved-pop 0.45s ease" : undefined,
        }}
      >
        {savedOk && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: 18, animation: "saved-check-draw 0.35s ease forwards", flexShrink: 0 }}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        <span>{savedOk ? t("Saved") : saving ? t("Saving...") : t("Save")}</span>
      </button>
    </div>
  );
}
