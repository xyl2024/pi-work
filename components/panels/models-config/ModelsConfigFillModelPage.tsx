"use client";

import { ModelCatalogPickerBody } from "@/components/settings/models-config/runtime";
import {
  fillModelsConfigModelFromCatalog,
  modelsConfigBack,
} from "@/lib/client/models-config-store";

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
