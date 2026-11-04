"use client";

import { useI18n } from "@/hooks/useI18n";
import { openSchedulerForm } from "@/lib/client/scheduler-panel";
import { ClockIcon, PlusIcon } from "@/components/ui/icons";

export function SchedulerSelectHint() {
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
      {t("Select a task to see its details")}
    </div>
  );
}

export function SchedulerCreateGuide({ cwd }: { cwd: string | null }) {
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
      <ClockIcon size={56} strokeWidth={1.2} style={{ color: "var(--text-muted)", margin: "0 auto 12px", display: "block" }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
        {t("No scheduled tasks yet")}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 16 }}>
        {t("Let the agent run any task automatically at a scheduled time")}
        <br />
        {t("e.g. daily report, hourly checks")}
      </div>
      <button
        type="button"
        onClick={() => void openSchedulerForm(null, cwd)}
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
        {t("New task")}
      </button>
    </div>
  );
}
