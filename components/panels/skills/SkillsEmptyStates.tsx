"use client";

import { useI18n } from "@/hooks/useI18n";
import { openSkillsForm } from "@/lib/client/skills-panel";
import { PlusIcon, ToolIcon } from "@/components/ui/icons";

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

export function SkillsInstallGuide() {
  const { t } = useI18n();
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        textAlign: "center",
        color: "var(--text-muted)",
      }}
    >
      <ToolIcon size={48} strokeWidth={1.2} style={{ color: "var(--text-muted)", margin: "0 auto 12px", display: "block" }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
        {t("No skills yet")}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 16 }}>
        {t("Search skills hint")}
      </div>
      <button
        type="button"
        onClick={() => void openSkillsForm()}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "var(--accent)",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "7px 14px",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <PlusIcon width={11} height={11} />
        {t("Add Skill")}
      </button>
    </div>
  );
}
