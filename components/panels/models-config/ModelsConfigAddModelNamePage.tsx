"use client";

import { AddModelNameStepBody } from "@/components/settings/models-config/runtime";
import {
  addModelsConfigModel,
  addModelsConfigModelFromCatalog,
  modelsConfigBack,
} from "@/lib/client/models-config-store";

export function ModelsConfigAddModelNamePage({ providerName }: { providerName: string }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <AddModelNameStepBody
        onBack={modelsConfigBack}
        onSelect={(model) => addModelsConfigModelFromCatalog(providerName, model)}
        onSkip={() => addModelsConfigModel(providerName)}
      />
    </div>
  );
}
