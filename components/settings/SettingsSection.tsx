"use client";

import type { ReactNode } from "react";
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "./registry";
import styles from "./SettingsModal.module.css";

export function settingsPageTitleId(id: SettingsSectionId): string {
  return `settings-page-title-${id}`;
}

export function SettingsSection({
  id,
  description,
  children,
}: {
  id: SettingsSectionId;
  description?: ReactNode;
  children: ReactNode;
}) {
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === id);
  if (!section) {
    throw new Error(`settings registry: no section registered for page ${id}`);
  }

  return (
    <section aria-labelledby={settingsPageTitleId(id)} className={styles.page}>
      {description && <p className={styles.pageDescription}>{description}</p>}
      {children}
    </section>
  );
}
