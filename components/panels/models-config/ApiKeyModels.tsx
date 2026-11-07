"use client";

import { useI18n } from "@/hooks/useI18n";
import { ModelTable } from "@/components/settings/models-config/ModelTable";
import { ListSkeleton } from "@/components/settings/models-config/ListSkeleton";
import { useModelsApi } from "@/components/settings/models-config/use-catalog-entries";
import { runtimeModelTableItems } from "@/lib/shared/models-config-table";
import styles from "./models-config.module.css";

export function ApiKeyModels({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const { data, loading, refreshing, refresh } = useModelsApi({
    providerId,
    messages: { refreshSuccessKey: "Models refreshed", refreshFailureKey: "Failed to refresh models" },
  });
  const items = runtimeModelTableItems(data.modelList, providerId);

  return (
    <section className={styles.authSection}>
      <div className={styles.toolbar}>
        <h3 className={styles.title}>{t("Available models")}</h3>
        <button
          type="button"
          className={styles.button}
          onClick={() => { void refresh(); }}
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
