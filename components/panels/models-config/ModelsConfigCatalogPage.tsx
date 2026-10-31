"use client";

import { useI18n } from "@/hooks/useI18n";
import { RuntimeModelCatalog } from "@/components/settings/models-config/runtime";
import { CatalogSourcesHelp } from "@/components/settings/models-config/CatalogSourcesHelp";
import { modelsConfigPanel } from "@/lib/client/models-config-panel";
import { PanelBackButton } from "../PanelBackButton";

export function ModelsConfigCatalogPage() {
  const { t } = useI18n();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 12px 0", flexShrink: 0 }}>
        <PanelBackButton panel={modelsConfigPanel} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
          {t("All model data")}
        </span>
        <CatalogSourcesHelp />
      </div>
      <RuntimeModelCatalog />
    </div>
  );
}
