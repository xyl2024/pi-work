"use client";

import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../../ui/Tooltip";
import { SectionTitle } from "./form-fields";
import styles from "./ModelRawSection.module.css";

export function ModelRawSection({
  summaryJson,
  editing,
  draft,
  error,
  onEnterEdit,
  onDraftChange,
  onCancel,
  onApply,
  onCopy,
}: {
  summaryJson: string;
  editing: boolean;
  draft: string;
  error: string | null;
  onEnterEdit: () => void;
  onDraftChange: (text: string) => void;
  onCancel: () => void;
  onApply: () => void;
  onCopy: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <SectionTitle>{t("Raw metadata")}</SectionTitle>
        {!editing && (
          <div className={styles.actions}>
            <Tooltip content={t("Copy raw JSON")}>
              <button type="button" onClick={onCopy} aria-label={t("Copy raw JSON")} className={styles.smallButton}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {t("Copy")}
              </button>
            </Tooltip>
            <button type="button" onClick={onEnterEdit} className={styles.smallButton}>
              {t("Edit as JSON")}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className={styles.editor}>
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            spellCheck={false}
            className={styles.textarea}
            data-invalid={error ? "true" : undefined}
          />
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.footer}>
            <button type="button" onClick={onCancel} className={styles.ghostButton}>
              {t("Cancel")}
            </button>
            <button type="button" onClick={onApply} className={styles.primaryButton}>
              {t("Apply raw JSON")}
            </button>
          </div>
        </div>
      ) : (
        <details>
          <summary className={styles.summary}>{t("Raw metadata")}</summary>
          <pre className={styles.preview}>{summaryJson}</pre>
        </details>
      )}
      <div className={styles.hint}>{t("Raw metadata hint")}</div>
    </div>
  );
}
