"use client";

import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "@/lib/client/clipboard";
import { ModelRawSection } from "@/components/settings/models-config/ModelRawSection";
import { useModelsConfigDeleteConfirm } from "@/components/panels/models-config/useModelsConfigDeleteConfirm";
import styles from "./FormTail.module.css";

export function FormRawSection({
  summaryJson,
  editing,
  draft,
  error,
  onEnterEdit,
  onDraftChange,
  onCancel,
  onApply,
}: {
  summaryJson: string;
  editing: boolean;
  draft: string;
  error: string | null;
  onEnterEdit: () => void;
  onDraftChange: (text: string) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();

  const copyRawJson = async () => {
    try {
      await copyText(summaryJson);
      toast.show({ kind: "success", message: t("Copied") });
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Network error") });
    }
  };

  return (
    <ModelRawSection
      summaryJson={summaryJson}
      editing={editing}
      draft={draft}
      error={error}
      onEnterEdit={onEnterEdit}
      onDraftChange={onDraftChange}
      onCancel={onCancel}
      onApply={onApply}
      onCopy={() => { void copyRawJson(); }}
    />
  );
}

export function FormDangerZone({ labelKey, onDelete }: { labelKey: string; onDelete: () => void }) {
  const { t } = useI18n();
  const confirmDelete = useModelsConfigDeleteConfirm();

  return (
    <div className={styles.dangerZone}>
      <button
        type="button"
        className={styles.dangerButton}
        onClick={() => { void confirmDelete(onDelete); }}
      >
        {t(labelKey)}
      </button>
    </div>
  );
}
