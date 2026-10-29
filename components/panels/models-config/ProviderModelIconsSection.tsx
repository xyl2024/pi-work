"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { ProviderGearIcon, ProviderIcon, resolveProviderIcon } from "@/components/ui/ProviderIcon";
import { SectionTitle } from "@/components/settings/models-config/form-fields";
import type { RuntimeCatalog, RuntimeModelInfo } from "@/lib/shared/models-config";
import {
  MODEL_ICON_LIST_COLLAPSE_THRESHOLD,
  MODEL_ICON_PREFERENCE_PROVIDER,
  canToggleModelIcon,
  isProviderIconPreferred,
  matchModelIcon,
  shouldCollapseModelIconList,
  type ModelIconPreferences,
} from "@/lib/shared/model-icon-match";
import {
  saveModelIconPreference,
  subscribeModelIconPreferences,
} from "@/lib/client/model-icon-preferences";

interface ModelsApiResponse {
  catalog?: RuntimeCatalog;
  modelIcons?: Record<string, string>;
  modelIconPreferences?: ModelIconPreferences;
}

/**
 * The "Models" section of one Subscriptions / API Key provider detail page.
 *
 * Both detail pages render this one component so the two entry points cannot
 * drift. It reads the provider's models from **模型目录** (`/api/models`
 * response `catalog`), which is credential-blind: models the provider is not
 * currently authenticated for are listed too. `modelList` is auth-filtered and
 * deliberately not used.
 *
 * Every decision (which rows get the toggle, the collapse threshold) lives in
 * `lib/shared/model-icon-match.ts`; this file is a thin shell that writes the
 * preference and renders the resulting icon. The write is immediate and does
 * not touch the panel's models-config draft / Save bar (ADR-0009 / ADR-0012).
 */
export function ProviderModelIconsSection({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [models, setModels] = useState<RuntimeModelInfo[]>([]);
  const [modelIcons, setModelIcons] = useState<Record<string, string>>({});
  const [preferences, setPreferences] = useState<ModelIconPreferences>({});
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
        setPreferences(data.modelIconPreferences ?? {});
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

  // A toggle in another provider's page (or a second window) still lands here:
  // the full preference map is broadcast, so patch the cached copy in place.
  useEffect(() => subscribeModelIconPreferences(setPreferences), []);

  const providerIconId = useMemo(
    () => resolveProviderIcon(providerId, undefined, modelIcons),
    [providerId, modelIcons],
  );

  const collapsed = !expanded && shouldCollapseModelIconList(models.length);
  const visibleModels = collapsed ? models.slice(0, MODEL_ICON_LIST_COLLAPSE_THRESHOLD) : models;

  const handleToggle = useCallback(async (modelId: string, useProviderIcon: boolean) => {
    const key = `${providerId}:${modelId}`;
    if (savingKey) return;
    setSavingKey(key);
    try {
      const next = await saveModelIconPreference(
        providerId,
        modelId,
        useProviderIcon ? MODEL_ICON_PREFERENCE_PROVIDER : "auto",
      );
      setPreferences(next);
    } catch {
      toast.show({ kind: "error", message: t("Failed to update icon preference") });
    } finally {
      setSavingKey(null);
    }
  }, [providerId, savingKey, t, toast]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <SectionTitle>{t("Models")}</SectionTitle>
        {!loading && !loadError && models.length > 0 && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>
            {t("{n} models", { n: models.length })}
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
        {t("Icon preference hint")}
      </p>

      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("Loading models...")}</div>
      ) : loadError ? (
        <div style={{ fontSize: 12, color: "var(--error)" }}>{loadError}</div>
      ) : models.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("No models")}</div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
            {visibleModels.map((model, index) => {
              const providerPreferred = isProviderIconPreferred(preferences, providerId, model.id);
              const effectiveIconId = resolveProviderIcon(providerId, model.id, modelIcons, preferences);
              const matchedIconId = matchModelIcon(model.id);
              const canToggle = canToggleModelIcon(model.id, providerIconId);
              const busy = savingKey !== null;
              return (
                <div
                  key={model.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "7px 9px",
                    minWidth: 0,
                    borderTop: index === 0 ? undefined : "1px solid var(--border)",
                    background: "var(--bg)",
                  }}
                >
                  <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                    {effectiveIconId
                      ? <ProviderIcon id={effectiveIconId} size={18} />
                      : <ProviderGearIcon size={16} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                      {model.name}
                    </span>
                    <span style={{ display: "block", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
                      {model.id}
                    </span>
                  </span>
                  {canToggle && (
                    <span
                      role="group"
                      aria-label={t("Icon preference")}
                      style={{ display: "flex", alignItems: "center", gap: 2, padding: 2, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", flexShrink: 0 }}
                    >
                      <button
                        type="button"
                        onClick={() => { void handleToggle(model.id, false); }}
                        disabled={busy}
                        aria-pressed={!providerPreferred}
                        title={t("Auto-matched icon")}
                        aria-label={`${t("Auto-matched icon")}: ${model.name}`}
                        style={segmentStyle(!providerPreferred, busy)}
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
                        style={segmentStyle(providerPreferred, busy)}
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
              style={{ alignSelf: "flex-start", padding: "4px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
            >
              {expanded ? t("Show less") : t("Show all ({n})", { n: models.length })}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function segmentStyle(active: boolean, busy: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    padding: 0,
    background: active ? "var(--bg)" : "none",
    border: `1px solid ${active ? "var(--accent)" : "transparent"}`,
    borderRadius: 4,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.55 : 1,
    flexShrink: 0,
  };
}
