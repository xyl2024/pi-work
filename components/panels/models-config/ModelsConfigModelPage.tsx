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
  modelsConfigPanel,
  openModelsConfigFillModel,
  removeModelsConfigModel,
  selectModelsConfigProblem,
  selectModelsConfigDirty,
  updateModelsConfigModel,
  updateModelsConfigRawEdit,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import { modelsConfigProblemText } from "@/lib/client/models-config-problem-text";
import { PanelBackButton } from "../PanelBackButton";

export function ModelsConfigModelPage({ providerName, index }: { providerName: string; index: number }) {
  const { t } = useI18n();
  const toast = useToast();
  const { view: state } = useModelsConfigPanel();
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
        <PanelBackButton panel={modelsConfigPanel} />
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
