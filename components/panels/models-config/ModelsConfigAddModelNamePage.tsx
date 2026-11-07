"use client";

import { CatalogSearch } from "@/components/settings/models-config/CatalogSearch";
import { useRuntimeCatalogEntries } from "@/components/settings/models-config/use-catalog-entries";
import {
  addModelsConfigModel,
  addModelsConfigModelFromCatalog,
  modelsConfigPanel,
} from "@/lib/client/models-config-panel";

export function ModelsConfigAddModelNamePage({ providerName }: { providerName: string }) {
  const { entries, loading, error } = useRuntimeCatalogEntries();

  return (
    <CatalogSearch
      entries={entries}
      loading={loading}
      error={error}
      onExit={() => modelsConfigPanel.back()}
      onSelect={(model) => addModelsConfigModelFromCatalog(providerName, model)}
      onSkip={() => addModelsConfigModel(providerName)}
    />
  );
}
