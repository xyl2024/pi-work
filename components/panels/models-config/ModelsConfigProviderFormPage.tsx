"use client";

import { useI18n } from "@/hooks/useI18n";
import { ProviderFields } from "@/components/settings/models-config/ProviderFields";
import { useModelsConfigDeleteConfirm } from "@/components/panels/models-config/useModelsConfigDeleteConfirm";
import {
  renameModelsConfigProvider,
  requestModelsConfigProviderDelete,
  updateModelsConfigProvider,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import styles from "./models-config.module.css";

export function ModelsConfigProviderFormPage({ name }: { name: string }) {
  const { t } = useI18n();
  const { view: state } = useModelsConfigPanel();
  const confirmDelete = useModelsConfigDeleteConfirm();
  const { config, providerNames } = state;
  const provider = config.providers?.[name];
  if (!provider) return null;

  return (
    <div className={styles.formPage}>
      <ProviderFields
        name={providerNames[name] ?? name}
        provider={provider}
        onChange={(next) => updateModelsConfigProvider(name, next)}
        onRename={(nextName) => renameModelsConfigProvider(name, nextName)}
      />
      <div className={styles.dangerZone}>
        <button
          type="button"
          onClick={() => { void confirmDelete(() => requestModelsConfigProviderDelete(name)); }}
          className={styles.dangerZoneButton}
        >
          {t("Delete provider")}
        </button>
      </div>
    </div>
  );
}
