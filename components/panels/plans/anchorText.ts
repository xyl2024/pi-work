// Display text for plan anchors and calendar weeks, shared by the row's anchor
// label, the create area's picked-anchor token and the mini month calendar so
// an anchor can never be worded two different ways (`9/28–10/4（属 9 月）`).
// Pure formatting — no DOM, no state.
import { monthKeyOf, shortDateKey, weekEndOf, type PlanAnchor } from "@/lib/shared/plans";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Localized month label for a `YYYY-MM` key (`2026年9月` / `Sep 2026`). */
export function monthLabel(monthKey: string, locale: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short" }).format(
    new Date(year, month - 1, 1),
  );
}

/**
 * The range a calendar week covers (`9/28–10/4`), plus which month owns it when
 * the week straddles a month (`9/28–10/4（属 9 月）`) — the week is filed under
 * its Monday's month, so a bare range would not say where it lives.
 */
export function weekRangeLabel(mondayKey: string, t: Translate, locale: string): string {
  const end = weekEndOf(mondayKey);
  const range = `${shortDateKey(mondayKey)}–${shortDateKey(end)}`;
  return monthKeyOf(mondayKey) === monthKeyOf(end)
    ? range
    : t("{range} (in {month})", { range, month: monthLabel(monthKeyOf(mondayKey), locale) });
}

/**
 * One-line text for an anchor: a day (`2026-09-15`, or `09-15` in a row where
 * the section already says the month), a week's range (plus its owning month
 * when it straddles one), or a month's label. `null` for the inbox, which has
 * no time to show.
 *
 * The single `switch` on `PlanAnchor["kind"]` for display text: the row label
 * and the picked-anchor token both come through here.
 */
export function anchorDisplayText(
  anchor: PlanAnchor,
  t: Translate,
  locale: string,
  day: "short" | "full" = "full",
): string | null {
  switch (anchor.kind) {
    case "inbox":
      return null;
    case "day":
      return day === "short" ? anchor.date.slice(5) : anchor.date;
    case "week":
      return weekRangeLabel(anchor.date, t, locale);
    case "month":
      return monthLabel(anchor.month, locale);
  }
}
