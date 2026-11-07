"use client";

import { useI18n } from "@/hooks/useI18n";
import styles from "./models-config.module.css";

export function AuthPageHeader({ title }: { title: string }) {
  const { t } = useI18n();

  return (
    <header className={styles.authHeader}>
      <h2 className={styles.authTitle}>{title}</h2>
      <p className={styles.authNotice}>
        <span className={styles.authNoticeDot} aria-hidden="true" />
        {t("Takes effect immediately — no save needed")}
      </p>
    </header>
  );
}
