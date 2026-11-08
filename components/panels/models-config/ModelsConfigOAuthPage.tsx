"use client";

import { useI18n } from "@/hooks/useI18n";
import { OAuthDetail } from "@/components/settings/models-config/OAuthDetail";
import { reloadModelsConfigOAuthProviders, useModelsConfigPanel } from "@/lib/client/models-config-panel";
import { AuthPageHeader } from "./AuthPageHeader";
import styles from "./models-config.module.css";

export function ModelsConfigOAuthPage({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const { view } = useModelsConfigPanel();
  const { oauthProviders } = view;
  const provider = oauthProviders.find((item) => item.id === providerId);

  return (
    <div className={styles.authPage}>
      <AuthPageHeader title={provider?.name ?? providerId} />
      {provider ? (
        <>
          <OAuthDetail key={provider.id} provider={provider} loginState={view.oauthLogin} onRefresh={reloadModelsConfigOAuthProviders} />
        </>
      ) : (
        <div className={styles.muted}>{t("No providers configured")}</div>
      )}
    </div>
  );
}
