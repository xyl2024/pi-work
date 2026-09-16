"use client";

// The one-tap anchor chips, shared by the create box and the row's re-schedule
// menu so the two can never drift apart in label, order or styling.
import { useI18n } from "@/hooks/useI18n";
import type { PlanAnchorChoice } from "@/lib/shared/plans";
import { ANCHOR_CHOICES, ANCHOR_CHOICE_LABEL_KEY } from "./anchorChoices";

/**
 * A row of 「收件箱 / 今天 / 明天 / 本周 / 本月」 chips.
 *
 * `activeChoice` marks the anchor the plan already sits on and disables that
 * chip: re-scheduling a plan to where it already is would be a pointless file
 * write. `label` is the optional leading text (the row says 「改到」, the create
 * box does not).
 */
export function AnchorChips({
  activeChoice = null,
  label,
  onSelect,
}: {
  activeChoice?: PlanAnchorChoice | null;
  label?: string;
  onSelect: (choice: PlanAnchorChoice) => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
      {label !== undefined && (
        <span style={{ fontSize: 10.5, color: "var(--text-dim)", marginRight: 2 }}>{label}</span>
      )}
      {ANCHOR_CHOICES.map((choice) => {
        const active = activeChoice === choice;
        return (
          <button
            key={choice}
            type="button"
            disabled={active}
            aria-pressed={active}
            onClick={() => onSelect(choice)}
            style={{
              padding: "2px 7px",
              fontSize: 10.5,
              color: active ? "var(--text)" : "var(--text-muted)",
              background: active ? "var(--bg-selected)" : "transparent",
              border: "1px solid var(--border)",
              borderRadius: 999,
              cursor: active ? "default" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t(ANCHOR_CHOICE_LABEL_KEY[choice])}
          </button>
        );
      })}
    </div>
  );
}
