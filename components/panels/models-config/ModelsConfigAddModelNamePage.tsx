"use client";

import { AddModelNameStepBody } from "@/components/settings/models-config/runtime";
import {
  addModelsConfigModel,
  addModelsConfigModelFromCatalog,
  modelsConfigBack,
} from "@/lib/client/models-config-store";

/**
 * The add-model page: full-text search the runtime catalog, pick with ↑/↓ +
 * Enter, or skip to an empty form. Selecting or skipping opens the new model's
 * detail page, so the whole flow stays on the panel's page stack.
 */
export function ModelsConfigAddModelNamePage({ providerName }: { providerName: string }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <AddModelNameStepBody
        onBack={modelsConfigBack}
        onClose={modelsConfigBack}
        onSelect={(model) => addModelsConfigModelFromCatalog(providerName, model)}
        onSkip={() => addModelsConfigModel(providerName)}
      />
    </div>
  );
}
