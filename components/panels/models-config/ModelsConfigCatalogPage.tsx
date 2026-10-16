"use client";

import { useI18n } from "@/hooks/useI18n";
import { RuntimeModelCatalog } from "@/components/settings/models-config/runtime";
import { CatalogSourcesHelp } from "@/components/settings/models-config/CatalogSourcesHelp";
import { ModelsConfigBackButton } from "./ModelsConfigBackButton";

/**
 * The model catalog (模型目录 / All model data) as a page *inside* the
 * models-config panel view — a root-level sibling of the provider list, not a
 * second panel or a second right-bar button. Back returns to the list.
 *
 * The body is the shared read-only `RuntimeModelCatalog`, which loads the
 * catalog on mount and re-fetches with `?refresh=true` when the user presses
 * Refresh, so "刷新目录" really replaces the data on screen. The "?" keeps the
 * catalog-sources explanation reachable from the panel.
 */
export function ModelsConfigCatalogPage() {
  const { t } = useI18n();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 12px 0", flexShrink: 0 }}>
        <ModelsConfigBackButton />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
          {t("All model data")}
        </span>
        <CatalogSourcesHelp />
      </div>
      <RuntimeModelCatalog />
    </div>
  );
}
