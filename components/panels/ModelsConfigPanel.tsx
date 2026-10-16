"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { currentModelsConfigPage } from "@/lib/shared/models-config-pages";
import { ensureModelsConfigLoaded, useModelsConfigStore } from "@/lib/client/models-config-store";
import { ModelsConfigRootPage } from "./models-config/ModelsConfigRootPage";
import { ModelsConfigProviderPage } from "./models-config/ModelsConfigProviderPage";
import { ModelsConfigSaveBar } from "./models-config/ModelsConfigSaveBar";

/**
 * The 模型配置 panel view body.
 *
 * The panel card only mounts the active tab's body, so this component is
 * stateless: the draft, the page stack and the save status all live in
 * `lib/client/models-config-store.ts`. Here it only wires the first-open load
 * and dispatches the current page to a full-width view, with the save footer
 * pinned outside the scroll area.
 */
export function ModelsConfigPanel() {
  const { t } = useI18n();
  const { loaded, loadError, pages } = useModelsConfigStore();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureModelsConfigLoaded();
  }, []);

  const page = currentModelsConfigPage(pages);

  // Each page is a full-width view, so entering or leaving one starts at the
  // top instead of inheriting the previous page's scroll offset.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [page]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div ref={scrollRef} data-scroll-side style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {loadError ? (
          <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--error)", fontSize: 12 }}>
            {t("Failed to load models")}
            <div style={{ marginTop: 6, color: "var(--text-dim)", fontSize: 11, wordBreak: "break-word" }}>{loadError}</div>
          </div>
        ) : !loaded ? (
          <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("Loading...")}
          </div>
        ) : page.kind === "provider" ? (
          <ModelsConfigProviderPage name={page.name} />
        ) : (
          <ModelsConfigRootPage />
        )}
      </div>
      {loaded && !loadError && <ModelsConfigSaveBar />}
    </div>
  );
}
