"use client";

import { useI18n } from "@/hooks/useI18n";

/**
 * The 技能 panel view body — skeleton only.
 *
 * This slice only cuts the panel open end to end (registry spec → right-bar
 * button → body); the placeholder below is deliberate. The pages (grouped
 * skill grid → detail → add), the module store and the panel-local Escape /
 * badge rules arrive in the follow-up slices, at which point this file becomes
 * the shell around them and keeps the same one-line registration.
 *
 * Like every panel view it renders inside the panel card, so it owns no chrome
 * of its own: the bold title below is placeholder content (the real root page
 * brings its own header row), and there is no `×` and no backdrop. The tab
 * strip is the only close affordance.
 */
export function SkillsPanel() {
  const { t } = useI18n();

  return (
    <div
      data-scroll-wide
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: "12px 16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>{t("Skills")}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("Coming soon")}</div>
    </div>
  );
}
