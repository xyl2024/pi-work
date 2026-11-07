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
import { ListSkeleton } from "@/components/settings/models-config/ListSkeleton";
import styles from "./models-config/models-config.module.css";

export function ModelsConfigPanel({
  onExit,
  visible = true,
}: {
  onExit?: () => void;
  visible?: boolean;
}) {
  const { t } = useI18n();
  const { view, pages } = useModelsConfigPanel();
  const { loaded, loadError, selected } = view;
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
      <div className={`${styles.stateBlock} ${styles.errorBlock}`}>
        {t("Failed to load models")}
        <div className={styles.errorDetail}>{loadError}</div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className={styles.skeletonBlock}>
        <ListSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div ref={containerRef} tabIndex={-1} className={styles.panel}>
      <div className={styles.panelBody}>
        <MainViewMasterDetail
          containerRef={containerRef}
          titleKey={formPage ? modelsConfigPageTitleKey(formPage) : null}
          onBack={formPage ? backToBrowse : null}
          full={
            formPage ? (
              <div ref={scrollRef} className={styles.scrollArea}>
                {renderForm(formPage)}
              </div>
            ) : null
          }
          list={<ModelsConfigProviderList />}
          detail={(onBack) => connectionPage ? (
            <div className={styles.scrollArea}>
              {onBack && (
                <button type="button" onClick={onBack} aria-label={t("Back")} className={styles.connectionBack}>
                  <ArrowLeftIcon width={14} height={14} aria-hidden="true" />{t("Providers")}
                </button>
              )}
              {renderForm(connectionPage)}
            </div>
          ) : <ModelsConfigProviderDetail onBack={onBack} />}
          hasDetail={connectionPage !== null || selected !== null}
          onClearDetail={connectionPage ? () => { clearModelsConfigProvider(); backToBrowse(); } : clearModelsConfigProvider}
          onExit={onExit}
          visible={visible}
          focusKey={`${page.kind}:${connectionPage?.providerId ?? selected?.name ?? ""}`}
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
