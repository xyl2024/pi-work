"use client";

import { useI18n } from "@/hooks/useI18n";
import { OAuthDetail } from "@/components/settings/models-config/OAuthDetail";
import { reloadModelsConfigOAuthProviders, useModelsConfigStore } from "@/lib/client/models-config-store";
import { ModelsConfigBackButton } from "./ModelsConfigBackButton";
import { ProviderModelIconsSection } from "./ProviderModelIconsSection";

/**
 * One subscription provider's page. It reuses the shared `OAuthDetail` body
 * (whose login session already outlives its own mount) and adds the panel's
 * level-up control; there is no second overlay to fall back to.
 */
export function ModelsConfigOAuthPage({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const { oauthProviders } = useModelsConfigStore();
  const provider = oauthProviders.find((item) => item.id === providerId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ModelsConfigBackButton />
        <span style={titleStyle}>{provider?.name ?? providerId}</span>
      </div>
      {provider ? (
        <>
          <OAuthDetail key={provider.id} provider={provider} onRefresh={reloadModelsConfigOAuthProviders} />
          <ProviderModelIconsSection providerId={provider.id} />
        </>
      ) : (
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("No providers configured")}</div>
      )}
    </div>
  );
}

const titleStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text)",
};
