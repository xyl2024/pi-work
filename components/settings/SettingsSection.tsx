"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "./registry";

/**
 * Page shell for one settings section.
 *
 * The settings modal renders exactly one of these at a time. The shell owns
 * the parts every page shares — the page title (from the registry, so the
 * sidebar and the page can never disagree about its name), an optional
 * description, and the content column's padding. The title scrolls with the
 * page; only the modal header is sticky.
 *
 * Sections render their content directly (no per-section wrapper): this shell
 * is the only wrapper, applied by the modal's page map.
 */
export function SettingsSection({
  id,
  description,
  children,
}: {
  id: SettingsSectionId;
  /** Optional line under the page title. */
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
