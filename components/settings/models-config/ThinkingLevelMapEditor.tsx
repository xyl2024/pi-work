"use client";

import { useI18n } from "@/hooks/useI18n";
import { THINKING_LEVELS, type ThinkingLevel } from "./constants";
import styles from "./ThinkingLevelMapEditor.module.css";

export function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
}) {
  const { t } = useI18n();
  const map = value ?? {};

  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") {
      delete next[level];
    } else {
      next[level] = entry;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div className={styles.rows}>
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state: "omit" | "null" | "string" =
          !(level in map) ? "omit" : raw === null ? "null" : "string";
        const strVal = typeof raw === "string" ? raw : "";

        return (
          <div key={level} className={styles.row} data-state={state}>
            <div className={styles.label}>
              <span className={styles.dot} data-level={level} />
              <span className={styles.level}>{level}</span>
            </div>

            <div className={styles.group}>
              <button
                type="button"
                className={styles.option}
                data-active={state === "omit" ? "true" : undefined}
                onClick={() => setLevel(level, "omit")}
              >
                {t("Default")}
              </button>
              <button
                type="button"
                className={styles.option}
                data-active={state === "null" ? "disabled" : undefined}
                onClick={() => setLevel(level, null)}
              >
                {t("Disabled")}
              </button>
            </div>

            <div className={styles.groupCustom} data-state={state}>
              <button
                type="button"
                className={`${styles.option} ${styles.customLabel}`}
                data-active={state === "string" ? "true" : undefined}
                onClick={() => setLevel(level, strVal || level)}
              >
                {t("Custom")}
              </button>
              <input
                value={strVal}
                onChange={(e) => setLevel(level, e.target.value)}
                onFocus={() => { if (state !== "string") setLevel(level, strVal || level); }}
                placeholder={level}
                maxLength={10}
                className={styles.input}
                data-state={state}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
