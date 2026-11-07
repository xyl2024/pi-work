"use client";

import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../../ui/Tooltip";
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
    <details className={styles.section}>
      <summary className={styles.summary}>
        <span className={styles.title}>{t("Raw JSON")}</span>
        {!editing && (
          <span className={styles.actions}>
            <Tooltip content={t("Copy raw JSON")}>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  onCopy();
                }}
                aria-label={t("Copy raw JSON")}
                className={styles.actionButton}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {t("Copy")}
              </button>
            </Tooltip>
            <button
              type="button"
              className={styles.actionButton}
              onClick={(event) => {
                event.preventDefault();
                onEnterEdit();
              }}
            >
              {t("Edit as JSON")}
            </button>
          </span>
        )}
      </summary>

      {editing ? (
        <div className={styles.editor}>
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            className={styles.textarea}
            data-invalid={error ? "true" : undefined}
          />
          {error && <div role="alert" className={styles.error}>{error}</div>}
          <div className={styles.editorActions}>
            <button type="button" className={styles.ghostButton} onClick={onCancel}>
              {t("Cancel")}
            </button>
            <button type="button" className={styles.primaryButton} onClick={onApply}>
              {t("Apply raw JSON")}
            </button>
          </div>
        </div>
      ) : (
        <pre className={styles.code}>{summaryJson}</pre>
      )}
      <p className={styles.hint}>{t("Raw metadata hint")}</p>
    </details>
  );
}
