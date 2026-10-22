"use client";

import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "@/lib/client/clipboard";
import { ModelConnectionTest } from "@/components/settings/models-config/ModelConnectionTest";
import { ModelFields } from "@/components/settings/models-config/ModelFields";
import { ModelRawSection } from "@/components/settings/models-config/ModelRawSection";
import {
  applyModelsConfigRawEdit,
  beginModelsConfigRawEdit,
  cancelModelsConfigRawEdit,
  modelsConfigBack,
  openModelsConfigFillModel,
  removeModelsConfigModel,
  selectModelsConfigProblem,
  selectModelsConfigDirty,
  updateModelsConfigModel,
  updateModelsConfigRawEdit,
  useModelsConfigStore,
} from "@/lib/client/models-config-store";
import { modelsConfigProblemText } from "@/lib/client/models-config-problem-text";

/**
 * One model's detail page. Full width, with a back control that returns to the
 * provider page it was opened from, and the shared `ModelFields` for everything
 * a model entry edits.
 *
 * The raw-JSON text lives in the panel store, so an unparsable edit survives a
 * tab switch and blocks the fixed save bar instead of being quietly dropped.
 * Deleting the model only edits the draft — the delete reaches disk when the
 * save bar is pressed.
 */
export function ModelsConfigModelPage({ providerName, index }: { providerName: string; index: number }) {
  const { t } = useI18n();
  const toast = useToast();
  const state = useModelsConfigStore();
  const model = state.config.providers?.[providerName]?.models?.[index];
  if (!model) return null;

  const summaryJson = JSON.stringify(model, null, 2);
  const rawEdit =
    state.rawEdit && state.rawEdit.providerName === providerName && state.rawEdit.index === index
      ? state.rawEdit
      : null;
  const problem = selectModelsConfigProblem(state);
  const rawError = modelsConfigProblemText(problem, t);

  const copyRawJson = async () => {
    try {
      await copyText(summaryJson);
      toast.show({ kind: "success", message: t("Copied") });
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Network error") });
    }
  };

  const title = model.name || model.id || t("new model");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={modelsConfigBack}
          style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", fontSize: 12, flexShrink: 0 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 6 9 12 15 18" />
          </svg>
          {t("Back")}
        </button>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>
          {title}
        </span>
        <button
          type="button"
          onClick={() => openModelsConfigFillModel(providerName, index)}
          style={{ padding: "3px 8px", background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 11, flexShrink: 0 }}
        >
          {t("Fill from model catalog")}
        </button>
        <button
          type="button"
          onClick={() => removeModelsConfigModel(providerName, index)}
          style={{ padding: "3px 8px", background: "none", border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)", borderRadius: 4, color: "var(--error)", cursor: "pointer", fontSize: 11, flexShrink: 0 }}
        >
          {t("Delete")}
        </button>
      </div>

      <ModelConnectionTest provider={providerName} modelId={model.id} disabled={selectModelsConfigDirty(state) || state.saving || !!state.rawEdit} />

      <ModelFields
        model={model}
        onChange={(next) => updateModelsConfigModel(providerName, index, next)}
      />

      <ModelRawSection
        summaryJson={summaryJson}
        editing={rawEdit !== null}
        draft={rawEdit?.text ?? ""}
        error={rawEdit ? rawError : null}
        onEnterEdit={() => beginModelsConfigRawEdit(providerName, index, summaryJson)}
        onDraftChange={updateModelsConfigRawEdit}
        onCancel={cancelModelsConfigRawEdit}
        onApply={applyModelsConfigRawEdit}
        onCopy={() => { void copyRawJson(); }}
      />
    </div>
  );
}
