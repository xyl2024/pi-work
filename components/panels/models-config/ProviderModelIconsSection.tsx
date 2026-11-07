"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { ProviderGearIcon, ProviderIcon, resolveProviderIcon } from "@/components/ui/ProviderIcon";
import { SectionTitle } from "@/components/settings/models-config/form-fields";
import { useModelsApi } from "@/components/settings/models-config/use-catalog-entries";
import { MODEL_ICON_LIST_COLLAPSE_THRESHOLD, shouldCollapseModelIconList } from "@/lib/shared/model-icon-list";
import {
  MODEL_ICON_PREFERENCE_AUTO,
  MODEL_ICON_PREFERENCE_PROVIDER,
  canToggleModelIcon,
  isProviderIconPreferred,
  matchModelIcon,
  modelIconPreferenceKey,
} from "@/lib/shared/model-icon-match";
import { saveModelIconPreference } from "@/lib/client/model-icon-preferences";
import {
  applyModelsConfigModelIconPreferences,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import { ListSkeleton } from "@/components/settings/models-config/ListSkeleton";
import styles from "./ProviderModelIconsSection.module.css";

export function ProviderModelIconsSection({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loaded, loading, error: loadError } = useModelsApi({
    messages: { loadFailureKey: "Failed to load models" },
  });
  const models = useMemo(
    () => data.catalog.providers.find((provider) => provider.id === providerId)?.models ?? [],
    [data.catalog.providers, providerId],
  );
  const modelIcons = data.modelIcons;
  const { modelIconPreferences: preferences } = useModelsConfigPanel().view;
  const [expanded, setExpanded] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) return;
    applyModelsConfigModelIconPreferences(data.modelIconPreferences);
  }, [data.modelIconPreferences, loaded]);

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
