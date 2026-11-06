"use client";

import { useCallback, useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ArrowLeftIcon } from "@/components/ui/icons";
import {
  MODELS_CONFIG_ROOT_PAGE,
  clearModelsConfigProvider,
  modelsConfigPanel,
  selectModelsConfigDirty,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import {
  isModelsConfigFormPage,
  modelsConfigPageTitleKey,
  type ModelsConfigFormPage,
} from "@/lib/shared/models-config";
import { MainViewMasterDetail } from "./MainViewMasterDetail";
import { ModelsConfigProviderList } from "./models-config/ModelsConfigProviderList";
import { ModelsConfigProviderDetail } from "./models-config/ModelsConfigProviderDetail";
import { ModelsConfigProviderFormPage } from "./models-config/ModelsConfigProviderFormPage";
import { ModelsConfigModelPage } from "./models-config/ModelsConfigModelPage";
import { ModelsConfigOAuthPage } from "./models-config/ModelsConfigOAuthPage";
import { ModelsConfigApiKeyPage } from "./models-config/ModelsConfigApiKeyPage";
import { ModelsConfigAddProviderPage } from "./models-config/ModelsConfigAddProviderPage";
import { ModelsConfigAddModelNamePage } from "./models-config/ModelsConfigAddModelNamePage";
import { ModelsConfigFillModelPage } from "./models-config/ModelsConfigFillModelPage";
import { ModelsConfigCatalogPage } from "./models-config/ModelsConfigCatalogPage";
import { ModelsConfigSaveBar } from "./models-config/ModelsConfigSaveBar";

export function ModelsConfigPanel({
  onExit,
  visible = true,
}: {
  onExit?: () => void;
  visible?: boolean;
}) {
  const { t } = useI18n();
  const { view, pages } = useModelsConfigPanel();
  const { loaded, loadError, selectedProvider } = view;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    modelsConfigPanel.open();
  }, []);

  const page = pages.length > 0 ? pages[pages.length - 1] : MODELS_CONFIG_ROOT_PAGE;
  const connectionPage = page.kind === "oauth" || page.kind === "apikey" ? page : null;
  const formPage = isModelsConfigFormPage(page) && !connectionPage ? page : null;
  const backToBrowse = useCallback(() => {
    modelsConfigPanel.back();
  }, []);
  const dirty = selectModelsConfigDirty(view) || view.oauthInProgress;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [page]);

  if (loadError) {
    return (
      <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--error)", fontSize: 12 }}>
        {t("Failed to load models")}
        <div style={{ marginTop: 6, color: "var(--text-dim)", fontSize: 11, wordBreak: "break-word" }}>{loadError}</div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
        {t("Loading...")}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, outline: "none" }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        <MainViewMasterDetail
          containerRef={containerRef}
          titleKey={formPage ? modelsConfigPageTitleKey(formPage) : null}
          onBack={formPage ? backToBrowse : null}
          full={
            formPage ? (
              <div ref={scrollRef} style={{ height: "100%", overflowY: "auto" }}>
                {renderForm(formPage)}
              </div>
            ) : null
          }
          list={<ModelsConfigProviderList />}
          detail={(onBack) => connectionPage ? (
            <div style={{ height: "100%", overflowY: "auto" }}>
              {onBack && (
                <button type="button" onClick={onBack} aria-label={t("Back")} style={{ display: "flex", alignItems: "center", gap: 6, margin: "12px 12px 0", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>
                  <ArrowLeftIcon width={14} height={14} aria-hidden="true" />{t("Providers")}
                </button>
              )}
              {renderForm(connectionPage)}
            </div>
          ) : <ModelsConfigProviderDetail onBack={onBack} />}
          hasDetail={connectionPage !== null || selectedProvider !== null}
          onClearDetail={connectionPage ? () => { clearModelsConfigProvider(); backToBrowse(); } : clearModelsConfigProvider}
          onExit={onExit}
          visible={visible}
          focusKey={`${page.kind}:${connectionPage?.providerId ?? selectedProvider ?? ""}`}
        />
      </div>
      {(formPage !== null || dirty || view.savedOk || view.saveError) && <ModelsConfigSaveBar />}
    </div>
  );
}

function renderForm(page: ModelsConfigFormPage) {
  switch (page.kind) {
    case "provider":
      return <ModelsConfigProviderFormPage key={page.name} name={page.name} />;
    case "model":
      return <ModelsConfigModelPage key={`${page.providerName}:${page.index}`} providerName={page.providerName} index={page.index} />;
    case "oauth":
      return <ModelsConfigOAuthPage key={page.providerId} providerId={page.providerId} />;
    case "apikey":
      return <ModelsConfigApiKeyPage key={page.providerId} providerId={page.providerId} />;
    case "addProvider":
      return <ModelsConfigAddProviderPage />;
    case "catalog":
      return <ModelsConfigCatalogPage />;
    case "addModelName":
      return <ModelsConfigAddModelNamePage providerName={page.providerName} />;
    case "fillModel":
      return (
        <ModelsConfigFillModelPage
          key={`${page.providerName}:${page.index}`}
          providerName={page.providerName}
          index={page.index}
        />
      );
  }
}
