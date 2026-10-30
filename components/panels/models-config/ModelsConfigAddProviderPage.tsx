"use client";

import { AddProviderPickerBody } from "@/components/settings/models-config/runtime";
import {
  addModelsConfigCustomProvider,
  modelsConfigBack,
  openModelsConfigApiKey,
  openModelsConfigOAuth,
  useModelsConfigStore,
} from "@/lib/client/models-config-store";

export function ModelsConfigAddProviderPage() {
  const { oauthProviders, apiKeyProviders } = useModelsConfigStore();
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <AddProviderPickerBody
        oauthProviders={oauthProviders}
        apiKeyProviders={apiKeyProviders}
        onSelectOAuth={openModelsConfigOAuth}
        onSelectApiKey={openModelsConfigApiKey}
        onAddCustom={addModelsConfigCustomProvider}
        onBack={modelsConfigBack}
      />
    </div>
  );
}
