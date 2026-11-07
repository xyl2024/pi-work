"use client";

import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "@/lib/client/clipboard";
import { ModelConnectionTest } from "@/components/settings/models-config/ModelConnectionTest";
import { ModelFields } from "@/components/settings/models-config/ModelFields";
import { ModelRawSection } from "@/components/settings/models-config/ModelRawSection";
import { useModelsConfigDeleteConfirm } from "@/components/panels/models-config/useModelsConfigDeleteConfirm";
import {
  applyModelsConfigRawEdit,
  beginModelsConfigRawEdit,
  cancelModelsConfigRawEdit,
  openModelsConfigFillModel,
  requestModelsConfigModelDelete,
  selectModelsConfigProblem,
  updateModelsConfigModel,
  updateModelsConfigRawEdit,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import { modelsConfigProblemText } from "@/lib/client/models-config-problem-text";
import styles from "./ModelPage.module.css";

export function ModelsConfigModelPage({ providerName, index }: { providerName: string; index: number }) {
  const { t } = useI18n();
  const toast = useToast();
  const { view: state } = useModelsConfigPanel();
  const confirmDelete = useModelsConfigDeleteConfirm();
  const model = state.config.providers?.[providerName]?.models?.[index];
  if (!model) return null;

  const summaryJson = JSON.stringify(model, null, 2);
  const rawEdit =
    state.rawEdit && state.rawEdit.providerName === providerName && state.rawEdit.index === index
      ? state.rawEdit
      : null;
  const problem = selectModelsConfigProblem(state);
  const rawProblem = rawEdit && (problem?.reason === "syntax" || problem?.reason === "not-object") ? problem : null;
  const rawError = modelsConfigProblemText(rawProblem, t);

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
    <div className={styles.page}>
      <div className={styles.body}>
        <header className={styles.identity}>
          <span className={styles.title}>{title}</span>
          <button
            type="button"
            className={styles.fillButton}
            onClick={() => openModelsConfigFillModel(providerName, index)}
          >
            {t("Fill from model catalog")}
          </button>
        </header>

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

        <div className={styles.dangerZone}>
          <button
            type="button"
            className={styles.deleteButton}
            onClick={() => { void confirmDelete(() => requestModelsConfigModelDelete(providerName, index)); }}
          >
            {t("Delete model")}
          </button>
        </div>
      </div>

      <ModelConnectionTest
        provider={providerName}
        modelId={model.id}
        disabled={state.saving}
        sticky
      />
    </div>
  );
}
