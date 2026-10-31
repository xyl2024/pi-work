"use client";

import { useI18n } from "@/hooks/useI18n";

export function HumanCallBadge() {
  const { t } = useI18n();
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: 3,
        flexShrink: 0,
        whiteSpace: "nowrap",
        background: "rgba(120,120,120,0.12)",
        color: "var(--text-dim)",
      }}
    >
      {t("Human Call")}
    </span>
  );
}
