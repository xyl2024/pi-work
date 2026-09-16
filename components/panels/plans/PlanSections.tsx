"use client";

import { useI18n } from "@/hooks/useI18n";
import { type Plan, type PlanAnchor, type PlanSectionId } from "@/lib/shared/plans";
import { Chevron } from "./Chevron";
import { anchorDisplayText } from "./anchorText";

/**
 * The panel's list presentation: the create area's anchor token, the empty
 * state, and the four list shapes (the sections of 紧凑 / 卡片, and 时间轴's
 * single axis). They are pure functions of the plans they are handed — every
 * decision (which plans, in what order, what a click does) stays in
 * `PlansPanel`, which is why these can be read top to bottom without following
 * a request.
 */

/** Renders one plan row. Supplied by the panel, which owns the row's state. */
export type RenderRow = (plan: Plan, showDate: boolean) => React.ReactNode;

/** The create anchor when it is *not* one of the one-tap chips — a day, week
 *  or month picked on the mini calendar. It shows what the next plan will use
 *  and gives a way back to the chips (which is also what clears the list
 *  highlight the pick added). */
export function PickedAnchorToken({ anchor, onClear }: { anchor: PlanAnchor; onClear: () => void }) {
  const { t, locale } = useI18n();
  const text = anchorDisplayText(anchor, t, locale);
  if (text === null) return null;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 4px 2px 7px",
        fontSize: 10.5,
        color: "var(--text)",
        background: "var(--bg-selected)",
        border: "1px solid var(--accent)",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: 9.5, color: "var(--text-dim)" }}>{t("New plan anchor")}</span>
      <span style={{ fontFamily: "var(--font-mono)" }}>{text}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={t("Clear")}
        title={t("Clear")}
        style={{
          display: "inline-flex",
          padding: 1,
          color: "var(--text-dim)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </span>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "4px 4px",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-muted)",
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </div>
  );
}

/** The shared empty state: with no plans at all it invites a first one, with
 *  plans on the record but none visible it says they are all done. */
export function EmptyPlans({ total }: { total: number }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        padding: "32px 12px",
        textAlign: "center",
        fontSize: 12,
        color: "var(--text-dim)",
      }}
    >
      {total > 0 ? t("All plans are completed") : t("No plans yet")}
    </div>
  );
}

/**
 * 时间轴 mode: no sections, one continuous axis. The inbox is pinned at the top
 * behind its own label — a plan without a time must not drift out of sight —
 * and every anchored plan below it is laid out past → today → future by
 * `orderPlansForTimeline`. Anchored rows always show their date so the axis
 * can be read; inbox rows have no time to show.
 */
export function TimelineList({ plans, renderRow }: { plans: Plan[]; renderRow: RenderRow }) {
  const { t } = useI18n();
  const inbox = plans.filter((plan) => plan.anchor.kind === "inbox");
  const anchored = plans.filter((plan) => plan.anchor.kind !== "inbox");
  return (
    <>
      {inbox.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <SectionLabel>{t("plans.inbox")}</SectionLabel>
          {inbox.map((plan) => renderRow(plan, false))}
        </div>
      )}
      {anchored.map((plan) => renderRow(plan, true))}
    </>
  );
}

export function LabeledSection({
  id,
  plans,
  renderRow,
}: {
  id: Exclude<PlanSectionId, "overdue">;
  plans: Plan[];
  renderRow: RenderRow;
}) {
  const { t } = useI18n();
  if (plans.length === 0) return null;

  return (
    <div style={{ marginBottom: 10 }}>
      <SectionLabel>{t(SECTION_LABEL_KEY[id])}</SectionLabel>
      {plans.map((plan) => renderRow(plan, id === "upcoming"))}
    </div>
  );
}

const SECTION_LABEL_KEY: Record<Exclude<PlanSectionId, "overdue">, string> = {
  inbox: "plans.inbox",
  today: "Today",
  week: "plans.week",
  month: "plans.month",
  upcoming: "Upcoming",
};

/**
 * Overdue plans live behind one collapsed row. The row counts and lists only
 * the *open* ones — a plan with a past anchor that is already done is history,
 * not a reminder, and would otherwise read "0 open" while showing items.
 */
export function OverdueSection({
  plans,
  open,
  onToggle,
  renderRow,
}: {
  plans: Plan[];
  open: boolean;
  onToggle: () => void;
  renderRow: RenderRow;
}) {
  const { t } = useI18n();
  const openPlans = plans.filter((plan) => !plan.done);
  if (openPlans.length === 0) return null;

  return (
    <div style={{ marginBottom: 10 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "4px 4px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          fontSize: 11,
          fontWeight: 600,
          textAlign: "left",
        }}
      >
        <Chevron open={open} />
        <span>{t("{n} overdue open plans", { n: openPlans.length })}</span>
      </button>
      {open && openPlans.map((plan) => renderRow(plan, true))}
    </div>
  );
}
