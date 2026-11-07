"use client";

import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "@/lib/client/clipboard";
import { ProviderFields } from "@/components/settings/models-config/ProviderFields";
import { AdvancedSettingsTable } from "@/components/settings/models-config/AdvancedSettingsTable";
import { ModelRawSection } from "@/components/settings/models-config/ModelRawSection";
import { useModelsConfigDeleteConfirm } from "@/components/panels/models-config/useModelsConfigDeleteConfirm";
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
import {
  advancedSettingEntries,
  withAdvancedSettingValue,
} from "@/lib/shared/models-config-advanced";
import type { ProviderEntry } from "@/lib/shared/models-config";
import styles from "./models-config.module.css";

export function ModelsConfigProviderFormPage({ name }: { name: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const { view: state } = useModelsConfigPanel();
  const confirmDelete = useModelsConfigDeleteConfirm();
  const { config, providerNames } = state;
  const provider = config.providers?.[name];
  if (!provider) return null;

  const providerRawEdit = state.providerRawEdit?.providerName === name ? state.providerRawEdit : null;
  const summaryJson = JSON.stringify(provider, null, 2);
  const problem = selectModelsConfigProblem(state);
  const nameError = problem && problem.location.providerName === name
    ? modelsConfigProblemText(problem, t) ?? undefined
    : undefined;
  const rawError = providerRawEdit
    ? modelsConfigProblemText(modelsConfigProblem(providerRawEdit.text, name), t)
    : null;

  const setAdvanced = (
    field: "headers" | "compat" | "modelOverrides",
    key: string,
    text: string,
  ) => {
    const value = withAdvancedSettingValue(provider[field], key, text);
    updateModelsConfigProvider(name, { ...provider, [field]: value } as ProviderEntry);
  };

  const copyRawJson = async () => {
    try {
      await copyText(summaryJson);
      toast.show({ kind: "success", message: t("Copied") });
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Network error") });
    }
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
        <summary className={styles.formSectionHeader}>
          <span>{t("Advanced")}</span>
          <span className={styles.formSectionHint}>{t("Headers · Compatibility · Model overrides")}</span>
        </summary>
        <div className={styles.formSectionBody}>
          <AdvancedSettingsTable
            label={t("Headers")}
            entries={advancedSettingEntries(provider.headers)}
            onChange={(key, text) => setAdvanced("headers", key, text)}
          />
          <AdvancedSettingsTable
            label={t("Compatibility")}
            entries={advancedSettingEntries(provider.compat)}
            onChange={(key, text) => setAdvanced("compat", key, text)}
          />
          <AdvancedSettingsTable
            label={t("Model overrides")}
            entries={advancedSettingEntries(provider.modelOverrides)}
            onChange={(key, text) => setAdvanced("modelOverrides", key, text)}
          />
        </div>
      </details>

      <details className={styles.formSection}>
        <summary className={styles.formSectionHeader}>{t("Raw JSON")}</summary>
        <div className={styles.formSectionBody}>
          <ModelRawSection
            summaryJson={summaryJson}
            editing={providerRawEdit !== null}
            draft={providerRawEdit?.text ?? ""}
            error={rawError}
            onEnterEdit={() => beginModelsConfigProviderRawEdit(name, summaryJson)}
            onDraftChange={updateModelsConfigProviderRawEdit}
            onCancel={cancelModelsConfigProviderRawEdit}
            onApply={applyModelsConfigProviderRawEdit}
            onCopy={() => { void copyRawJson(); }}
          />
        </div>
      </details>

      <section className={`${styles.formSection} ${styles.dangerZone}`}>
        <span className={styles.formSectionHeader}>{t("Danger zone")}</span>
        <button
          type="button"
          className={styles.dangerButton}
          onClick={() => { void confirmDelete(() => requestModelsConfigProviderDelete(name)); }}
        >
          {t("Delete provider")}
        </button>
      </section>
    </div>
  );
}
