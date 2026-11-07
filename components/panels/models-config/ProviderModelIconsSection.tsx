"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { ProviderGearIcon, ProviderIcon, resolveProviderIcon } from "@/components/ui/ProviderIcon";
import { SectionTitle } from "@/components/settings/models-config/form-fields";
import type { RuntimeCatalog, RuntimeModelInfo } from "@/lib/shared/models-config";
import { MODEL_ICON_LIST_COLLAPSE_THRESHOLD, shouldCollapseModelIconList } from "@/lib/shared/model-icon-list";
import {
  MODEL_ICON_PREFERENCE_AUTO,
  MODEL_ICON_PREFERENCE_PROVIDER,
  canToggleModelIcon,
  isProviderIconPreferred,
  matchModelIcon,
  modelIconPreferenceKey,
  type ModelIconPreferences,
} from "@/lib/shared/model-icon-match";
import { saveModelIconPreference } from "@/lib/client/model-icon-preferences";
import {
  applyModelsConfigModelIconPreferences,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import { ListSkeleton } from "@/components/settings/models-config/ListSkeleton";
import styles from "./ProviderModelIconsSection.module.css";

interface ModelsApiResponse {
  catalog?: RuntimeCatalog;
  modelIcons?: Record<string, string>;
  modelIconPreferences?: ModelIconPreferences;
}

export function ProviderModelIconsSection({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [models, setModels] = useState<RuntimeModelInfo[]>([]);
  const [modelIcons, setModelIcons] = useState<Record<string, string>>({});
  const { modelIconPreferences: preferences } = useModelsConfigPanel().view;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch("/api/models", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as ModelsApiResponse;
        if (cancelled) return;
        const catalogProvider = data.catalog?.providers.find((provider) => provider.id === providerId);
        setModels(catalogProvider?.models ?? []);
        setModelIcons(data.modelIcons ?? {});
        applyModelsConfigModelIconPreferences(data.modelIconPreferences ?? {});
      } catch (e) {
        if (cancelled) return;
        setModels([]);
        setLoadError(e instanceof Error && e.message ? e.message : t("Failed to load models"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [providerId, t]);

  const providerIconId = useMemo(
    () => resolveProviderIcon(providerId, undefined, modelIcons),
    [providerId, modelIcons],
  );

  const collapsed = !expanded && shouldCollapseModelIconList(models.length);
  const visibleModels = collapsed ? models.slice(0, MODEL_ICON_LIST_COLLAPSE_THRESHOLD) : models;

  const handleToggle = useCallback(async (modelId: string, useProviderIcon: boolean) => {
    const key = modelIconPreferenceKey(providerId, modelId);
    if (savingKey) return;
    setSavingKey(key);
    try {
      const next = await saveModelIconPreference(
        providerId,
        modelId,
        useProviderIcon ? MODEL_ICON_PREFERENCE_PROVIDER : MODEL_ICON_PREFERENCE_AUTO,
      );
      applyModelsConfigModelIconPreferences(next);
    } catch {
      toast.show({ kind: "error", message: t("Failed to update icon preference") });
    } finally {
      setSavingKey(null);
    }
  }, [providerId, savingKey, t, toast]);

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <SectionTitle>{t("Models")}</SectionTitle>
        {!loading && !loadError && models.length > 0 && (
          <span className={styles.count}>
            {t("{n} models", { n: models.length })}
          </span>
        )}
      </div>
      <p className={styles.hint}>
        {t("Icon preference hint")}
      </p>

      {loading ? (
        <ListSkeleton rows={4} label={t("Loading models...")} />
      ) : loadError ? (
        <div className={styles.error}>{loadError}</div>
      ) : models.length === 0 ? (
        <div className={styles.empty}>{t("No models")}</div>
      ) : (
        <>
          <div className={styles.list}>
            {visibleModels.map((model) => {
              const providerPreferred = isProviderIconPreferred(preferences, providerId, model.id);
              const effectiveIconId = resolveProviderIcon(providerId, model.id, modelIcons, preferences);
              const matchedIconId = matchModelIcon(model.id);
              const canToggle = canToggleModelIcon(
                model.id,
                providerIconId,
                modelIcons[modelIconPreferenceKey(providerId, model.id)] ?? modelIcons[model.id],
              );
              const busy = savingKey !== null;
              return (
                <div key={model.id} className={styles.row}>
                  <span className={styles.rowIcon}>
                    {effectiveIconId
                      ? <ProviderIcon id={effectiveIconId} size={18} />
                      : <ProviderGearIcon size={16} />}
                  </span>
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>
                      {model.name}
                    </span>
                    <span className={styles.rowId}>
                      {model.id}
                    </span>
                  </span>
                  {canToggle && (
                    <span role="group" aria-label={t("Icon preference")} className={styles.toggle}>
                      <button
                        type="button"
                        onClick={() => { void handleToggle(model.id, false); }}
                        disabled={busy}
                        aria-pressed={!providerPreferred}
                        title={t("Auto-matched icon")}
                        aria-label={`${t("Auto-matched icon")}: ${model.name}`}
                        className={styles.segment}
                      >
                        {matchedIconId
                          ? <ProviderIcon id={matchedIconId} size={15} />
                          : <ProviderGearIcon size={13} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleToggle(model.id, true); }}
                        disabled={busy}
                        aria-pressed={providerPreferred}
                        title={t("Provider icon")}
                        aria-label={`${t("Provider icon")}: ${model.name}`}
                        className={styles.segment}
                      >
                        {providerIconId
                          ? <ProviderIcon id={providerIconId} size={15} />
                          : <ProviderGearIcon size={13} />}
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {shouldCollapseModelIconList(models.length) && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className={styles.expand}
            >
              {expanded ? t("Show less") : t("Show all ({n})", { n: models.length })}
            </button>
          )}
        </>
      )}
    </div>
  );
}
