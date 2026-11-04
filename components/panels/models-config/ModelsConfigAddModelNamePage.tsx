"use client";

import { AddModelNameStepBody } from "@/components/settings/models-config/runtime";
import {
  addModelsConfigModel,
  addModelsConfigModelFromCatalog,
  modelsConfigPanel,
} from "@/lib/client/models-config-panel";

export function ModelsConfigAddModelNamePage({ providerName }: { providerName: string }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <AddModelNameStepBody
        backButton={null}
        onBack={() => modelsConfigPanel.back()}
        onSelect={(model) => addModelsConfigModelFromCatalog(providerName, model)}
        onSkip={() => addModelsConfigModel(providerName)}
      />
    </div>
  );
}
