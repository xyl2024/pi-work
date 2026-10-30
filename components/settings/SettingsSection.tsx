"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "./registry";

export function SettingsSection({
  id,
  description,
  children,
}: {
  id: SettingsSectionId;
  description?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === id);
  if (!section) {
    throw new Error(`settings registry: no section registered for page ${id}`);
  }
  const titleId = `settings-page-title-${id}`;

  return (
    <section aria-labelledby={titleId}>
      <h2
        id={titleId}
        style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 700,
          color: "var(--text)",
          lineHeight: 1.3,
        }}
      >
        {t(section.labelKey)}
      </h2>
      {description && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {description}
        </p>
      )}
      <div style={{ marginTop: 14 }}>{children}</div>
    </section>
  );
}
