"use client";

import { useI18n } from "@/hooks/useI18n";
import { ModelConnectionTest } from "@/components/settings/models-config/ModelConnectionTest";
import { ModelFields } from "@/components/settings/models-config/ModelFields";
import { FormDangerZone, FormRawSection } from "@/components/panels/models-config/FormTail";
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
  const { view: state } = useModelsConfigPanel();
  const model = state.config.providers?.[providerName]?.models?.[index];
  if (!model) return null;

  const summaryJson = JSON.stringify(model, null, 2);
  const rawEdit =
    state.rawEdit && state.rawEdit.providerName === providerName && state.rawEdit.index === index
      ? state.rawEdit
      : null;
  const problem = selectModelsConfigProblem(state);
  const rawProblem = rawEdit && (problem?.reason === "syntax" || problem?.reason === "not-object") ? problem : null;
  const rawError = modelsConfigProblemText(rawProblem, t, state.providerNames[providerName] ?? providerName);

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

        <FormRawSection
          summaryJson={summaryJson}
          editing={rawEdit !== null}
          draft={rawEdit?.text ?? ""}
          error={rawEdit ? rawError : null}
          onEnterEdit={() => beginModelsConfigRawEdit(providerName, index, summaryJson)}
          onDraftChange={updateModelsConfigRawEdit}
          onCancel={cancelModelsConfigRawEdit}
          onApply={applyModelsConfigRawEdit}
        />

        <FormDangerZone
          labelKey="Delete model"
          onDelete={() => requestModelsConfigModelDelete(providerName, index)}
        />
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
