"use client";

import { CatalogSearch } from "@/components/settings/models-config/CatalogSearch";
import { useRuntimeCatalogEntries } from "@/components/settings/models-config/use-catalog-entries";
import {
  fillModelsConfigModelFromCatalog,
  modelsConfigPanel,
} from "@/lib/client/models-config-panel";

export function ModelsConfigFillModelPage({
  providerName,
  index,
}: {
  providerName: string;
  index: number;
}) {
  const { entries, loading, error } = useRuntimeCatalogEntries();

  return (
    <CatalogSearch
      entries={entries}
      loading={loading}
      error={error}
      onExit={() => modelsConfigPanel.back()}
      onSelect={(model) => fillModelsConfigModelFromCatalog(providerName, index, model)}
    />
  );
}
