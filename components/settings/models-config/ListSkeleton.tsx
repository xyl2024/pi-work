"use client";

import { useI18n } from "@/hooks/useI18n";
import styles from "./ListSkeleton.module.css";

export function ListSkeleton({ rows = 6, label }: { rows?: number; label?: string }) {
  const { t } = useI18n();

  return (
    <div className={styles.skeleton} role="status" aria-label={label ?? t("Loading...")}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.row}>
          <span className={`${styles.bar} ${styles.icon}`} />
          <span className={`${styles.bar} ${styles.name}`} />
          <span className={`${styles.bar} ${styles.tag}`} />
          <span className={`${styles.bar} ${styles.number}`} />
        </div>
      ))}
    </div>
  );
}
