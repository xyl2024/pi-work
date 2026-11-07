"use client";

import { useI18n } from "@/hooks/useI18n";
import { ProviderFields } from "@/components/settings/models-config/ProviderFields";
import { AdvancedSettings } from "@/components/settings/models-config/AdvancedSettings";
import { FormDangerZone, FormRawSection } from "@/components/panels/models-config/FormTail";
import {
  applyModelsConfigProviderRawEdit,
  beginModelsConfigProviderRawEdit,
  cancelModelsConfigProviderRawEdit,
  renameModelsConfigProvider,
  requestModelsConfigProviderDelete,
  selectModelsConfigProblem,
  updateModelsConfigProvider,
  updateModelsConfigProviderRawEdit,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import { modelsConfigProblemText } from "@/lib/client/models-config-problem-text";
import { modelsConfigProblem } from "@/lib/shared/models-config-draft";
import type { ProviderEntry } from "@/lib/shared/models-config";
import styles from "./models-config.module.css";

type ProviderAdvancedField = "headers" | "compat" | "modelOverrides";

export function ModelsConfigProviderFormPage({ name }: { name: string }) {
  const { t } = useI18n();
  const { view: state } = useModelsConfigPanel();
  const { config, providerNames } = state;
  const provider = config.providers?.[name];
  if (!provider) return null;

  const providerRawEdit = state.providerRawEdit?.providerName === name ? state.providerRawEdit : null;
  const summaryJson = JSON.stringify(provider, null, 2);
  const problem = selectModelsConfigProblem(state);
  const displayName = providerNames[name] ?? name;
  const nameError = problem && problem.location.providerName === name
    ? modelsConfigProblemText(problem, t, displayName) ?? undefined
    : undefined;
  const rawError = providerRawEdit
    ? modelsConfigProblemText(modelsConfigProblem(providerRawEdit.text, name), t, displayName)
    : null;

  const setAdvanced = (field: ProviderAdvancedField) => (next: Record<string, unknown> | undefined) => {
    updateModelsConfigProvider(name, { ...provider, [field]: next } as ProviderEntry);
  };

  return (
    <div className={styles.formPage}>
      <section className={styles.formSection}>
        <ProviderFields
          name={providerNames[name] ?? name}
          provider={provider}
          onChange={(next) => updateModelsConfigProvider(name, next)}
          onRename={(nextName) => renameModelsConfigProvider(name, nextName)}
          nameError={nameError}
        />
      </section>

      <details className={styles.formSection}>
        <summary className={styles.formSectionHeader}>{t("Advanced")}</summary>
        <div className={styles.formSectionBody}>
          <AdvancedSettings
            title={t("Provider settings")}
            groups={[
              {
                key: "headers",
                label: t("Headers"),
                value: provider.headers as Record<string, unknown> | undefined,
                onChange: setAdvanced("headers"),
              },
              {
                key: "compat",
                label: "compat",
                value: provider.compat as Record<string, unknown> | undefined,
                onChange: setAdvanced("compat"),
              },
              {
                key: "modelOverrides",
                label: "modelOverrides",
                value: provider.modelOverrides as Record<string, unknown> | undefined,
                onChange: setAdvanced("modelOverrides"),
              },
            ]}
          />
        </div>
      </details>

      <FormRawSection
        summaryJson={summaryJson}
        editing={providerRawEdit !== null}
        draft={providerRawEdit?.text ?? ""}
        error={rawError}
        onEnterEdit={() => beginModelsConfigProviderRawEdit(name, summaryJson)}
        onDraftChange={updateModelsConfigProviderRawEdit}
        onCancel={cancelModelsConfigProviderRawEdit}
        onApply={applyModelsConfigProviderRawEdit}
      />

      <FormDangerZone
        labelKey="Delete provider"
        onDelete={() => requestModelsConfigProviderDelete(name)}
      />
    </div>
  );
}
