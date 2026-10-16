"use client";

import { useI18n } from "@/hooks/useI18n";
import { ApiKeyDetail } from "@/components/settings/models-config/runtime";
import { reloadModelsConfigApiKeyProviders, useModelsConfigStore } from "@/lib/client/models-config-store";
import { ModelsConfigBackButton } from "./ModelsConfigBackButton";

/**
 * One API-key provider's page: paste / replace / remove the key plus the
 * runtime model list, reusing the modal's `ApiKeyDetail` body with the panel's
 * level-up control instead of a close button.
 */
export function ModelsConfigApiKeyPage({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const { apiKeyProviders } = useModelsConfigStore();
  const provider = apiKeyProviders.find((item) => item.id === providerId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ModelsConfigBackButton />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {provider?.displayName ?? providerId}
        </span>
      </div>
      {provider ? (
        <ApiKeyDetail key={provider.id} provider={provider} onRefresh={reloadModelsConfigApiKeyProviders} />
      ) : (
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("No providers configured")}</div>
      )}
    </div>
  );
}
