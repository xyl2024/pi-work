"use client";

import { useI18n } from "@/hooks/useI18n";
import { schedulerBack } from "@/lib/client/scheduler-store";

export function SchedulerBackButton() {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={schedulerBack}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 9px",
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: 5,
        color: "var(--text-muted)",
        cursor: "pointer",
        fontSize: 12,
        flexShrink: 0,
        fontFamily: "inherit",
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="15 6 9 12 15 18" />
      </svg>
      {t("Back")}
    </button>
  );
}
