"use client";

import { AddProviderPickerBody } from "@/components/settings/models-config/AddProviderPicker";
import {
  addModelsConfigCustomProvider,
  openModelsConfigApiKey,
  openModelsConfigOAuth,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import styles from "./models-config.module.css";

export function ModelsConfigAddProviderPage() {
  const { oauthProviders, apiKeyProviders } = useModelsConfigPanel().view;
  return (
    <div className={styles.pageColumn}>
      <AddProviderPickerBody
        backButton={null}
        oauthProviders={oauthProviders}
        apiKeyProviders={apiKeyProviders}
        onSelectOAuth={openModelsConfigOAuth}
        onSelectApiKey={openModelsConfigApiKey}
        onAddCustom={addModelsConfigCustomProvider}
      />
    </div>
  );
}
