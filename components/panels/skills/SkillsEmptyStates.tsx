"use client";

import { useI18n } from "@/hooks/useI18n";

export function SkillSelectHint() {
  const { t } = useI18n();
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        fontSize: 13,
        color: "var(--text-muted)",
      }}
    >
      {t("Select a skill")}
    </div>
  );
}
