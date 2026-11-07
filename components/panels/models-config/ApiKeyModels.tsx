"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { ModelTable } from "@/components/settings/models-config/ModelTable";
import { ListSkeleton } from "@/components/settings/models-config/ListSkeleton";
import { runtimeModelTableItems } from "@/lib/shared/models-config-table";
import type { RuntimeModelInfo } from "@/lib/shared/models-config";
import styles from "./models-config.module.css";

export function ApiKeyModels({ providerId, configured }: { providerId: string; configured: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [models, setModels] = useState<RuntimeModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const url = refresh
        ? `/api/models?refresh=true&provider=${encodeURIComponent(providerId)}`
        : "/api/models";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { modelList?: RuntimeModelInfo[] };
      setModels(data.modelList ?? []);
      if (refresh) toast.show({ kind: "success", message: t("Models refreshed") });
    } catch (e) {
      setModels([]);
      if (refresh) toast.show({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to refresh models") });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [providerId, t, toast]);

  useEffect(() => {
    void load();
  }, [providerId, configured, load]);

  const items = runtimeModelTableItems(models, providerId);

  return (
    <section className={styles.authSection}>
      <div className={styles.toolbar}>
        <h3 className={styles.title}>{t("Available models")}</h3>
        <button
          type="button"
          className={styles.button}
          onClick={() => { void load(true); }}
          disabled={loading || refreshing}
        >
          {refreshing ? t("Refreshing...") : t("Refresh models")}
        </button>
      </div>
      {loading ? (
        <ListSkeleton rows={4} label={t("Loading models...")} />
      ) : items.length === 0 ? (
        <p className={styles.muted}>{t("No available models")}</p>
      ) : (
        <div className={styles.modelTable}>
          <ModelTable label={t("Available models")} items={items} />
        </div>
      )}
    </section>
  );
}
