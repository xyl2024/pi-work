"use client";

import { AddProviderPickerBody } from "@/components/settings/models-config/runtime";
import {
  addModelsConfigCustomProvider,
  modelsConfigPanel,
  openModelsConfigApiKey,
  openModelsConfigOAuth,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import { PanelBackButton } from "../PanelBackButton";

export function ModelsConfigAddProviderPage() {
  const { oauthProviders, apiKeyProviders } = useModelsConfigPanel().view;
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <AddProviderPickerBody
        backButton={<PanelBackButton panel={modelsConfigPanel} />}
        oauthProviders={oauthProviders}
        apiKeyProviders={apiKeyProviders}
        onSelectOAuth={openModelsConfigOAuth}
        onSelectApiKey={openModelsConfigApiKey}
        onAddCustom={addModelsConfigCustomProvider}
        onBack={() => modelsConfigPanel.back()}
      />
    </div>
  );
}
