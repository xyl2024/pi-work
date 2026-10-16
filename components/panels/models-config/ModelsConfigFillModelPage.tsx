"use client";

import { ModelCatalogPickerBody } from "@/components/settings/models-config/runtime";
import {
  fillModelsConfigModelFromCatalog,
  modelsConfigBack,
} from "@/lib/client/models-config-store";

/**
 * "Fill this model from the catalog": pick an existing catalog model and copy
 * its fields onto the model being edited, then fall back to that model's page.
 * Only model fields are touched; provider settings stay as they are.
 */
export function ModelsConfigFillModelPage({
  providerName,
  index,
}: {
  providerName: string;
  index: number;
}) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <ModelCatalogPickerBody
        onBack={modelsConfigBack}
        onSelect={(model) => fillModelsConfigModelFromCatalog(providerName, index, model)}
      />
    </div>
  );
}
