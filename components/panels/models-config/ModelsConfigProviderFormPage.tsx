"use client";

import { ProviderFields } from "@/components/settings/models-config/ProviderFields";
import {
  renameModelsConfigProvider,
  updateModelsConfigProvider,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";

export function ModelsConfigProviderFormPage({ name }: { name: string }) {
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
    </div>
  );
}
