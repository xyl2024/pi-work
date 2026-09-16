"use client";

// The panel's resident mini month calendar. It is a *projection* of the list
// the panel is already showing: the grid comes from `monthCalendarWeeks` and
// the badges from `countPlans`, so it makes no request of its own. Clicking a
// day / a week / the month title picks that anchor for the next new plan (and
// navigates the list, in the panel above); 0-count periods are still pickable.
//
// Monday is the first column because a calendar week is Monday–Sunday here
// (ADR-0006), and a week that straddles a month is labelled with the month
// that owns it — its Monday's.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  addMonths,
  countPlans,
  isCrossMonthWeek,
  monthCalendarWeeks,
  monthKeyOf,
  shortDateKey,
  toDateKey,
  type Plan,
  type PlanAnchor,
} from "@/lib/shared/plans";
import { monthLabel, weekRangeLabel } from "./anchorText";

/** sessionStorage key for the collapsed flag. Deliberately a *session*
 *  preference (the appearance mode of #48 is the durable sibling), so it
 *  survives a reload but not a new browsing session. */
const COLLAPSED_KEY = "pi-work.plans.calendar-collapsed";

/** Monday first, matching the calendar week the anchors use. */
const WEEKDAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Week-count gutter + seven day cells. */
const GRID = "20px repeat(7, minmax(0, 1fr))";

interface MiniCalendarProps {
  /** Every loaded plan; the badges are counted from these, never fetched. */
  plans: readonly Plan[];
  /** The anchor the create box would use right now — the calendar marks the
   *  matching cell as selected. */
  selected: PlanAnchor;
  /** A calendar pick: sets the create anchor and navigates the list. */
  onSelect: (anchor: PlanAnchor) => void;
}

export function MiniCalendar({ plans, selected, onSelect }: MiniCalendarProps) {
  const { t, locale } = useI18n();
  const today = toDateKey(new Date());
  // The month on screen. Starts on the month of the anchor already selected —
  // which is today's month on a fresh open.
  const [monthKey, setMonthKey] = useState(() =>
    selected.kind === "month" ? selected.month : monthKeyOf(today),
  );
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  // Restore the collapsed flag after mount, never during render: the server
  // prerender has no sessionStorage, so reading it there would break
  // hydration.
  useEffect(() => {
    try {
      setCollapsed(sessionStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      /* storage unavailable — stay expanded */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      sessionStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const counts = useMemo(() => countPlans(plans), [plans]);
  const weeks = useMemo(() => monthCalendarWeeks(monthKey), [monthKey]);
  const monthCount = counts.months.get(monthKey) ?? 0;
  const monthSelected = selected.kind === "month" && selected.month === monthKey;

  if (collapsed) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <NavButton label={t("Expand calendar")} onClick={toggleCollapsed}>
          <Chevron open={false} />
        </NavButton>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("Calendar")}</span>
        <button
          type="button"
          onClick={() => setMonthKey(monthKeyOf(today))}
          style={{
            padding: "1px 4px",
            fontSize: 10.5,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dim)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          {monthLabel(monthKey, locale)}
        </button>
      </div>
    );
  }

  return (
    <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0, padding: "5px 8px 7px" }}>
      {/* Header: collapse · month (a month anchor) · count · today · paging */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <NavButton label={t("Collapse calendar")} onClick={toggleCollapsed}>
          <Chevron open />
        </NavButton>
        <button
          type="button"
          onClick={() => onSelect({ kind: "month", month: monthKey })}
          aria-pressed={monthSelected}
          aria-label={t("Select this month")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "1px 5px",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
            color: monthSelected ? "var(--bg)" : "var(--text)",
            background: monthSelected ? "var(--accent)" : "transparent",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
          }}
        >
          {monthLabel(monthKey, locale)}
          {monthCount > 0 && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: monthSelected ? "var(--bg)" : "var(--accent)",
              }}
            >
              {monthCount}
            </span>
          )}
        </button>
        <span style={{ flex: 1 }} />
        <NavButton label={t("Today")} onClick={() => setMonthKey(monthKeyOf(today))}>
          <span style={{ fontFamily: "inherit" }}>{t("Today")}</span>
        </NavButton>
        <NavButton label={t("Previous month")} onClick={() => setMonthKey(addMonths(monthKey, -1))}>
          <Arrow dir="left" />
        </NavButton>
        <NavButton label={t("Next month")} onClick={() => setMonthKey(addMonths(monthKey, 1))}>
          <Arrow dir="right" />
        </NavButton>
      </div>

      {/* Weekday header: Monday first */}
      <div style={{ display: "grid", gridTemplateColumns: GRID, marginTop: 4 }}>
        <span />
        {WEEKDAY_KEYS.map((key) => (
          <span
            key={key}
            style={{ textAlign: "center", fontSize: 9, color: "var(--text-dim)" }}
          >
            {t(key)}
          </span>
        ))}
      </div>

      {weeks.map((week) => {
        const weekCount = counts.weeks.get(week.start) ?? 0;
        const weekSelected = selected.kind === "week" && selected.date === week.start;
        const weekHovered = hovered === week.start;
        const cross = isCrossMonthWeek(week);
        return (
          <div key={week.start}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "stretch" }}>
              <button
                type="button"
                onClick={() => onSelect({ kind: "week", date: week.start })}
                onMouseEnter={() => setHovered(week.start)}
                onMouseLeave={() => setHovered(null)}
                aria-pressed={weekSelected}
                aria-label={t("Select this week")}
                title={`${shortDateKey(week.start)}–${shortDateKey(week.days[6])}`}
                style={{
                  height: 22,
                  padding: 0,
                  border: "none",
                  borderRadius: 5,
                  background: weekSelected
                    ? "var(--bg-selected)"
                    : weekHovered
                      ? "var(--bg-hover)"
                      : "transparent",
                  boxShadow: weekSelected ? "inset 0 0 0 1px var(--accent)" : undefined,
                  color: weekCount > 0 ? "var(--accent)" : "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  fontWeight: weekSelected ? 700 : 500,
                  cursor: "pointer",
                }}
              >
                {weekCount > 0 ? weekCount : ""}
              </button>

              {week.days.map((day) => {
                const inMonth = monthKeyOf(day) === monthKey;
                const daySelected = selected.kind === "day" && selected.date === day;
                const dayCount = counts.days.get(day) ?? 0;
                const dayHovered = hovered === day;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => onSelect({ kind: "day", date: day })}
                    onMouseEnter={() => setHovered(day)}
                    onMouseLeave={() => setHovered(null)}
                    aria-pressed={daySelected}
                    title={dayCount > 0 ? t("{n} plans", { n: dayCount }) : undefined}
                    style={{
                      position: "relative",
                      height: 22,
                      padding: 0,
                      border: "none",
                      borderRadius: 5,
                      background: daySelected
                        ? "var(--accent)"
                        : dayHovered
                          ? "var(--bg-hover)"
                          : "transparent",
                      color: daySelected ? "var(--bg)" : inMonth ? "var(--text)" : "var(--text-dim)",
                      opacity: inMonth ? 1 : 0.5,
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      cursor: "pointer",
                    }}
                  >
                    {Number(day.slice(8))}
                    {dayCount > 0 && (
                      <span
                        style={{
                          position: "absolute",
                          top: 0,
                          right: 2,
                          fontSize: 8,
                          lineHeight: "10px",
                          fontWeight: 600,
                          color: daySelected ? "var(--bg)" : "var(--accent)",
                        }}
                      >
                        {dayCount}
                      </span>
                    )}
                    {day === today && !daySelected && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: 1,
                          left: "50%",
                          transform: "translateX(-50%)",
                          width: 3,
                          height: 3,
                          borderRadius: "50%",
                          background: "var(--accent)",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            {/* A week that straddles a month is filed under its Monday's
                month, so name that month — otherwise the range alone would
                not say where the week lives. */}
            {cross && (
              <div
                style={{
                  padding: "0 2px 1px",
                  textAlign: "right",
                  fontSize: 9,
                  color: "var(--text-dim)",
                }}
              >
                {weekRangeLabel(week.start, t, locale)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 3px",
        fontSize: 10,
        color: "var(--text-dim)",
        background: "transparent",
        border: "none",
        borderRadius: 5,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function Arrow({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points={dir === "left" ? "14 6 8 12 14 18" : "10 6 16 12 10 18"} />
    </svg>
  );
}
