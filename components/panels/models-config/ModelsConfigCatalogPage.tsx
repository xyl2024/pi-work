"use client";

import { useMemo } from "react";
import { CatalogBrowser } from "@/components/settings/models-config/CatalogBrowser";
import { catalogConfiguredKeys } from "@/lib/shared/catalog-sections";
import { useModelsConfigPanel } from "@/lib/client/models-config-panel";

export function ModelsConfigCatalogPage() {
  const { view } = useModelsConfigPanel();
  const configured = useMemo(() => catalogConfiguredKeys(view.config), [view.config]);

  return <CatalogBrowser configured={configured} />;
}
