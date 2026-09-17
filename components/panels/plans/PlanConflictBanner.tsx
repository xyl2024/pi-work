"use client";

import type { CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { PlanConflictState } from "@/lib/client/plans";

export interface PlanConflictBannerProps {
  conflict: PlanConflictState;
  onResolve: (choice: "overwrite" | "reload") => void;
  onDismiss: () => void;
  /** Placement (margins) belongs to whichever surface hosts the banner. */
  style?: CSSProperties;
}

/**
 * The 「覆盖 / 重载」 answer to a write the server refused with 409, rendered at
 * the place that triggered it: on the row for a completion toggle or a
 * re-schedule, at the bottom of the detail dialog for a note save (#51). The
 * wording, the three actions and their meaning are the same in both places —
 * this component is the one place they are written.
 */
export function PlanConflictBanner({
  conflict,
  onResolve,
  onDismiss,
  style,
}: PlanConflictBannerProps) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        padding: "6px 8px",
        fontSize: 11,
        color: "var(--text)",
        background: "var(--bg-subtle)",
        border: "1px solid var(--warning)",
        borderRadius: 5,
        ...style,
      }}
    >
      <span style={{ flex: 1, minWidth: 120 }}>
        {conflict.code === "missing"
          ? t("This plan was moved or renamed outside the panel")
          : t("This plan changed outside the panel")}
      </span>
      <ConflictButton onClick={() => onResolve("overwrite")}>{t("Overwrite")}</ConflictButton>
      {/* A moved file has somewhere to reload *to*; a content change only has
          the disk version, so the label says what the second choice does. */}
      {conflict.code === "missing" && conflict.movedTo === null ? null : (
        <ConflictButton onClick={() => onResolve("reload")}>
          {conflict.code === "missing" ? t("Reload to the new location") : t("Reload")}
        </ConflictButton>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("Dismiss")}
        style={{
          display: "inline-flex",
          padding: 2,
          background: "transparent",
          border: "none",
          color: "var(--text-dim)",
          cursor: "pointer",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

function ConflictButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0,
        padding: "2px 8px",
        fontSize: 11,
        color: "var(--text)",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 5,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
