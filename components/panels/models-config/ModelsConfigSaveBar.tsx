"use client";

import { useI18n } from "@/hooks/useI18n";
import {
  focusModelsConfigProblem,
  revertModelsConfigDraft,
  saveModelsConfig,
  selectModelsConfigChangeCount,
  selectModelsConfigProblem,
  selectModelsConfigSaveBarPhase,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import { modelsConfigProblemText } from "@/lib/client/models-config-problem-text";
import styles from "./models-config.module.css";

export function ModelsConfigSaveBar() {
  const { t } = useI18n();
  const { view } = useModelsConfigPanel();
  const phase = selectModelsConfigSaveBarPhase(view);
  const problem = selectModelsConfigProblem(view);
  const problemText = modelsConfigProblemText(problem, t);
  const count = selectModelsConfigChangeCount(view);
  const saveDisabled = phase !== "dirty" && phase !== "failed";

  return (
    <div className={styles.saveBar}>
      <span
        className={styles.saveBarStatus}
        data-tone={phase === "failed" ? "error" : undefined}
        role={phase === "failed" ? "alert" : "status"}
      >
        {phase === "failed" ? view.saveError
          : phase === "blocked" && problem && problemText ? (
            <button type="button" className={styles.saveBarProblem} onClick={() => focusModelsConfigProblem(problem)}>
              {problemText}
            </button>
          )
          : phase === "saving" ? t("Saving...")
          : phase === "saved" ? t("Saved")
          : phase === "dirty" ? t("{n} unsaved changes", { n: count })
          : null}
      </span>
      {count > 0 && phase !== "saving" && (
        <button type="button" className={styles.button} onClick={revertModelsConfigDraft}>
          {t("Discard all")}
        </button>
      )}
      <button
        type="button"
        className={`${styles.button} ${styles.primary} ${phase === "saved" ? styles.saveBarSaved : ""}`}
        onClick={() => { void saveModelsConfig(); }}
        disabled={saveDisabled}
      >
        {phase === "saved" && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={styles.saveBarCheck}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        <span>{phase === "saved" ? t("Saved") : phase === "saving" ? t("Saving...") : t("Save")}</span>
      </button>
    </div>
  );
}
