"use client";

import { useI18n } from "@/hooks/useI18n";
import { ApiKeyDetail } from "@/components/settings/models-config/runtime";
import { reloadModelsConfigApiKeyProviders, useModelsConfigPanel } from "@/lib/client/models-config-panel";
import { ApiKeyModels } from "./ApiKeyModels";
import { AuthPageHeader } from "./AuthPageHeader";
import styles from "./models-config.module.css";

export function ModelsConfigApiKeyPage({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const { apiKeyProviders } = useModelsConfigPanel().view;
  const provider = apiKeyProviders.find((item) => item.id === providerId);

  return (
    <div className={styles.authPage}>
      <AuthPageHeader title={provider?.displayName ?? providerId} />
      {provider ? (
        <>
          <ApiKeyDetail key={provider.id} provider={provider} onRefresh={reloadModelsConfigApiKeyProviders} />
          <ApiKeyModels key={`${provider.id}:models:${provider.configured}`} providerId={provider.id} />
        </>
      ) : (
        <div className={styles.muted}>{t("No providers configured")}</div>
      )}
    </div>
  );
}
