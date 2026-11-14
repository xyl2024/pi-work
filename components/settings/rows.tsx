"use client";

import type { ReactNode } from "react";
import styles from "./rows.module.css";

export function SettingsGroup({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.group}>
      {(title || action) && (
        <div className={styles.groupHeader}>
          {title ? <h3 className={styles.groupTitle}>{title}</h3> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  stacked,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={[styles.row, stacked ? styles.rowStacked : ""].filter(Boolean).join(" ")}>
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>{title}</span>
        {description && <span className={styles.rowDescription}>{description}</span>}
      </div>
      {children && <div className={styles.rowControl}>{children}</div>}
    </div>
  );
}

export function SettingsNote({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "error" | "success";
}) {
  const toneClass = tone === "error" ? styles.noteError : tone === "success" ? styles.noteSuccess : "";
  return <p className={[styles.note, toneClass].filter(Boolean).join(" ")}>{children}</p>;
}
