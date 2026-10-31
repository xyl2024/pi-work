"use client";

import { useI18n } from "@/hooks/useI18n";
import { OAuthDetail } from "@/components/settings/models-config/OAuthDetail";
import { modelsConfigPanel, reloadModelsConfigOAuthProviders, useModelsConfigPanel } from "@/lib/client/models-config-panel";
import { PanelBackButton } from "../PanelBackButton";
import { ProviderModelIconsSection } from "./ProviderModelIconsSection";

export function ModelsConfigOAuthPage({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const { view } = useModelsConfigPanel();
  const { oauthProviders } = view;
  const provider = oauthProviders.find((item) => item.id === providerId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <PanelBackButton panel={modelsConfigPanel} />
        <span style={titleStyle}>{provider?.name ?? providerId}</span>
      </div>
      {provider ? (
        <>
          <OAuthDetail key={provider.id} provider={provider} loginState={view.oauthLogin} onRefresh={reloadModelsConfigOAuthProviders} />
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
