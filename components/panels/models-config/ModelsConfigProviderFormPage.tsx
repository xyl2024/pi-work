"use client";

import { useI18n } from "@/hooks/useI18n";
import { ProviderFields } from "@/components/settings/models-config/ProviderFields";
import {
  deleteModelsConfigProvider,
  renameModelsConfigProvider,
  updateModelsConfigProvider,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";

export function ModelsConfigProviderFormPage({ name }: { name: string }) {
  const { t } = useI18n();
  const { view: state } = useModelsConfigPanel();
  const { config, providerNames } = state;
  const provider = config.providers?.[name];
  if (!provider) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 12 }}>
      <ProviderFields
        name={providerNames[name] ?? name}
        provider={provider}
        onChange={(next) => updateModelsConfigProvider(name, next)}
        onRename={(nextName) => renameModelsConfigProvider(name, nextName)}
      />
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <button
          type="button"
          onClick={() => deleteModelsConfigProvider(name)}
          style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--error)", cursor: "pointer", fontSize: 12 }}
        >
          {t("Delete provider")}
        </button>
      </div>
    </div>
  );
}
