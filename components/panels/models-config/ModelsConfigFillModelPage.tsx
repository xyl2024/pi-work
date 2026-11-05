"use client";

import { ModelCatalogPickerBody } from "@/components/settings/models-config/runtime";
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
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <ModelCatalogPickerBody
        backButton={null}
        onBack={() => modelsConfigPanel.back()}
        onSelect={(model) => fillModelsConfigModelFromCatalog(providerName, index, model)}
      />
    </div>
  );
}
