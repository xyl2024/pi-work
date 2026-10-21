"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { usePanelEscapeGuard } from "@/hooks/usePanelEscapeGuard";
import { currentModelsConfigPage } from "@/lib/shared/models-config-pages";
import {
  ensureModelsConfigLoaded,
  escapeModelsConfig,
  useModelsConfigStore,
} from "@/lib/client/models-config-store";
import { ModelsConfigRootPage } from "./models-config/ModelsConfigRootPage";
import { ModelsConfigProviderPage } from "./models-config/ModelsConfigProviderPage";
import { ModelsConfigModelPage } from "./models-config/ModelsConfigModelPage";
import { ModelsConfigOAuthPage } from "./models-config/ModelsConfigOAuthPage";
import { ModelsConfigApiKeyPage } from "./models-config/ModelsConfigApiKeyPage";
import { ModelsConfigAddProviderPage } from "./models-config/ModelsConfigAddProviderPage";
import { ModelsConfigAddModelNamePage } from "./models-config/ModelsConfigAddModelNamePage";
import { ModelsConfigFillModelPage } from "./models-config/ModelsConfigFillModelPage";
import { ModelsConfigCatalogPage } from "./models-config/ModelsConfigCatalogPage";
import { ModelsConfigSaveBar } from "./models-config/ModelsConfigSaveBar";

/**
 * The 模型配置 panel view body.
 *
 * The panel card only mounts the active tab's body, so this component is
 * stateless: the draft, the page stack and the save status all live in
 * `lib/client/models-config-store.ts`. Here it only wires the first-open load,
 * dispatches the current page to a full-width view, and turns Escape into
 * "up one level" — falling back to the panel tab's close rule from the list.
 */
export function ModelsConfigPanel({ onCloseTab }: { onCloseTab?: () => void }) {
  const { t } = useI18n();
  const { loaded, loadError, pages } = useModelsConfigStore();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureModelsConfigLoaded();
  }, []);

  const page = currentModelsConfigPage(pages);
  const fullHeightPage =
    page.kind === "addProvider" ||
    page.kind === "addModelName" ||
    page.kind === "fillModel" ||
    page.kind === "catalog";

  // Each page is a full-width view, so entering or leaving a scrolling one
  // starts at the top instead of inheriting the previous page's offset. The
  // full-height pages scroll inside themselves and are left alone.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [page]);

  // Escape means "up one level"; only the provider list lets it fall through to
  // the tab's close rule. Focus is kept inside the panel while it is the active
  // surface, so a palette / dialog that has taken focus keeps its own Escape.
  useEffect(() => {
    // Renaming a provider also updates `page`. Keep an active field focused
    // instead of moving focus back to the panel after every keystroke.
    if (containerRef.current?.contains(document.activeElement)) return;
    containerRef.current?.focus({ preventScroll: true });
  }, [page]);

  usePanelEscapeGuard(containerRef, () => {
    if (escapeModelsConfig().closePanel) onCloseTab?.();
  });

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, outline: "none" }}
    >
      <div
        ref={scrollRef}
        data-scroll-side
        style={{ flex: 1, minHeight: 0, overflowY: fullHeightPage ? "hidden" : "auto" }}
      >
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
        ) : page.kind === "model" ? (
          <ModelsConfigModelPage providerName={page.providerName} index={page.index} />
        ) : page.kind === "oauth" ? (
          <ModelsConfigOAuthPage providerId={page.providerId} />
        ) : page.kind === "apikey" ? (
          <ModelsConfigApiKeyPage providerId={page.providerId} />
        ) : page.kind === "addProvider" ? (
          <ModelsConfigAddProviderPage />
        ) : page.kind === "catalog" ? (
          <ModelsConfigCatalogPage />
        ) : page.kind === "addModelName" ? (
          <ModelsConfigAddModelNamePage providerName={page.providerName} />
        ) : page.kind === "fillModel" ? (
          <ModelsConfigFillModelPage providerName={page.providerName} index={page.index} />
        ) : (
          <ModelsConfigRootPage />
        )}
      </div>
      {loaded && !loadError && <ModelsConfigSaveBar />}
    </div>
  );
}
