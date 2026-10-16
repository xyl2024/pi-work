"use client";

import { AddProviderPickerBody } from "@/components/settings/models-config/runtime";
import {
  addModelsConfigCustomProvider,
  modelsConfigBack,
  openModelsConfigApiKey,
  openModelsConfigOAuth,
  useModelsConfigStore,
} from "@/lib/client/models-config-store";

/**
 * The add-provider page: the modal's three-way picker (custom / subscription /
 * API key) mounted as a full-width panel page. Custom opens the new provider's
 * form; subscription and API-key entries open their own detail pages. Nothing
 * here escapes the panel, so the modal's second full-screen overlay is gone.
 */
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
        onClose={modelsConfigBack}
        onBack={modelsConfigBack}
      />
    </div>
  );
}
